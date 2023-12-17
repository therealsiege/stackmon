// Copyright 2018 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');
const sendProvisionResponse = require('../sendProvisionResponse');
const getLambdaFunctionTags = require('../getLambdaFunctionTags');

module.exports.provision = async message => {
  switch (message.RequestType) {
    case 'Create':
    case 'Update':
      await createOrUpdate(message);
      break;

    case 'Delete':
      await del(message);
      break;

    default:
      throw new Error(`Invalid CloudFormation custom resource RequestType '${message.RequestType}'`);
  }
};

async function createOrUpdateAgentCommanderFunction (message, region, tags) {
  const runtime = process.env.AWS_EXECUTION_ENV.replace(/^AWS_Lambda_/, '');
  const lambda = new AWS.Lambda({ region });

  try {
    await lambda.createFunction({
      FunctionName: 'stackery-agent-commander',
      Runtime: runtime,
      Role: `arn:aws:iam::${process.env.AWS_ACCOUNT_ID}:role/stackery/stackery-agent-commander-role`,
      Handler: 'index.handler',
      Code: {
        S3Bucket: `stackery-${message.ResourceProperties.StackeryEnv}-${region}-agent-commander`,
        S3Key: `stackery-agent-commander-${message.ResourceProperties.AgentVersion}.zip`
      },
      Description: 'Provisions Stackery custom resources',
      Timeout: 30,
      MemorySize: 1024,
      Environment: {
        Variables: commanderEnvVars()
      },
      Tags: tags
    }).promise();

    console.log(`Created stackery-agent-commander function in region ${region}`);

    return;
  } catch (err) {
    /* If the function already exists, fall through to update it. Otherwise,
     * re-throw error. */
    if (err.code !== 'ResourceConflictException') {
      throw new Error(`Error while attempting to create stackery-agent-commander function in createOrUpdateAgentCommanderFunction in ${region}. Error: ${err.message} (${err.code})`);
    }
  }

  /* Runtime must be updated before code if existing function's runtime is
   * obsolete. Updating code when runtime is obsolete will fail. */
  try {
    await lambda.updateFunctionConfiguration({
      FunctionName: 'stackery-agent-commander',
      Environment: {
        Variables: commanderEnvVars()
      },
      Runtime: runtime
    }).promise();
  } catch (err) {
    throw new Error(`Error while attempting to update stackery-agent-commander function while running lambda.updateFunctionConfiguration in ${region}. Error: ${err.message} (${err.code})`);
  }

  try {
    await lambda.updateFunctionCode({
      FunctionName: 'stackery-agent-commander',
      S3Bucket: `stackery-${message.ResourceProperties.StackeryEnv}-${region}-agent-commander`,
      S3Key: `stackery-agent-commander-${message.ResourceProperties.AgentVersion}.zip`
    }).promise();
  } catch (err) {
    throw new Error(`Error while attempting to update stackery-agent-commander function while running lambda.updateFunctionCode in ${region}. Error: ${err.message} (${err.code})`);
  }

  let currentTags;
  try {
    currentTags = await getLambdaFunctionTags(process.env.AWS_LAMBDA_FUNCTION_NAME, region);
  } catch (err) {
    throw new Error(`Error while attempting to get existing stackery-agent-commander tags in region ${region}: ${err.message} (${err.code})`);
  }

  const deletedTags = new Set(Object.keys(currentTags));
  for (const newTagKey of Object.keys(tags)) {
    deletedTags.delete(newTagKey);
  }

  const functionArn = `arn:aws:lambda:${region}:${process.env.AWS_ACCOUNT_ID}:function:${process.env.AWS_LAMBDA_FUNCTION_NAME}`;

  if (Object.keys(tags).length > 0) {
    try {
      await lambda.tagResource({
        Resource: functionArn,
        Tags: tags
      }).promise();
    } catch (err) {
      throw new Error(`Error while attempting to set new tags on existing stackery-agent-commander in region ${region}: ${err.message} (${err.code})`);
    }
  }

  if (deletedTags.size > 0) {
    try {
      await lambda.untagResource({
        Resource: functionArn,
        TagKeys: Array.from(deletedTags)
      }).promise();
    } catch (err) {
      throw new Error(`Error while attempting remove tags from existing stackery-agent-commander in region ${region}: ${err.message} (${err.code})`);
    }
  }

  console.log(`Updated stackery-agent-commander function in region ${region}`);
}

const commanderEnvVars = () => {
  const envVars = {
    AWS_ACCOUNT_ID: process.env.AWS_ACCOUNT_ID,
    PROVISION_CHECK_QUEUE_URL: process.env.PROVISION_CHECK_QUEUE_URL,
    EXTERNAL_ID: process.env.EXTERNAL_ID
  };

  if (process.env.STACKERY_API) {
    envVars.STACKERY_API = process.env.STACKERY_API;
  }

  return envVars;
};

/* Docker Task resources require a 'default' cluster to be created (if you don't
 * want to have to manually create and specify another cluster). */
async function createDefaultECSCluster (region) {
  const ecs = new AWS.ECS({ region });

  const { clusters } = await ecs.describeClusters({ clusters: ['default'] }).promise();

  if (clusters.length > 0 && clusters[0].status === 'ACTIVE') {
    return;
  }
  try {
    await ecs.createCluster({ clusterName: 'default' }).promise();
  } catch (err) {
    throw new Error(`createDefaultECSCluster error: ${err.message} (${err.code})`);
  }
  console.log(`Created 'default' ECS cluster in region ${region}`);
}

/* ECS needs a service-linked IAM role for Fargate. This is created in the
 * management console when you point-and-click to create your first default
 * cluster, but is not created when we create the default clusters in this
 * bootstrap process. */
async function createECSServiceLinkedRole () {
  const iam = new AWS.IAM();

  for (let retry = 0; retry < 4; ++retry) {
    try {
      if (retry > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      await iam.createServiceLinkedRole({ AWSServiceName: 'ecs.amazonaws.com' }).promise();
      console.log('Created ECS service-linked role AWSServiceRoleForECS');
      return;
    } catch (err) {
      if (err.message === 'Service role name AWSServiceRoleForECS has been taken in this account, please try a different suffix.') {
        console.log('Found existing ECS service-linked role AWSServiceRoleForECS');
        return;
      }
      console.warn(`createServiceLinkedRole error: ${err.message}`);
    }
  }
}

async function createDefaultVPC (region) {
  const ec2 = new AWS.EC2({ region });

  try {
    await ec2.createDefaultVpc().promise();
    console.log(`Created default VPC in region ${region}`);
  } catch (err) {
    /* There's no published error code for this condition, and we can't make a
     * test account with EC2-Classic to find out. We know the error message is:
     * "Accounts on the EC2-Classic platform cannot create a default VPC." */
    if (err.message.includes('EC2-Classic')) {
      console.log(`Could not create default VPC in region ${region}: ${err.message} (${err.code})`);
      console.log('Some Stackery resources may fail to provision into this region (e.g. RDS Database Instances or ECS Docker Tasks not placed in a Virtual Network)');
    } else if (err.code === 'OptInRequired') {
      console.log(`Skipping creation of the default VPC in region ${region} as this region is not enabled`);
      console.log('Some Stackery resources may fail to provision into this region (e.g. RDS Database Instances or ECS Docker Tasks not placed in a Virtual Network)');
    } else if (err.code === 'VpcLimitExceeded') {
      console.log(`Skipping creation of the default VPC in region ${region} due to limit on number of VPCs`);
      console.log('Some Stackery resources may fail to provision into this region (e.g. RDS Database Instances or ECS Docker Tasks not placed in a Virtual Network)');
    } else if (err.code === 'UnauthorizedOperation') {
      console.log(`Skipping creation of the default VPC in region ${region} due to lack of permissions to create VPCs`);
      console.log('Some Stackery resources may fail to provision into this region (e.g. RDS Database Instances or ECS Docker Tasks not placed in a Virtual Network)');
    } else if (err.code !== 'DefaultVpcAlreadyExists') {
      throw new Error(`Error while attempting to create a default VPC in region ${region}: ${err.message} (${err.code})`);
    }
  }
}

async function createOrUpdate (message) {
  const tags = await getLambdaFunctionTags(process.env.AWS_LAMBDA_FUNCTION_NAME);

  await Promise.all(message.ResourceProperties.Regions
    .filter(region => region !== process.env.AWS_REGION)
    .map(region => createOrUpdateAgentCommanderFunction(message, region, tags))
    .concat(message.ResourceProperties.Regions.map(createDefaultECSCluster))
    .concat(message.ResourceProperties.Regions.map(createDefaultVPC))
  );

  await createECSServiceLinkedRole();

  await sendProvisionResponse('stackery-agent-commanders', null, 'SUCCESS', message);
}

async function del (message) {
  const regions = message.ResourceProperties.Regions.filter(region => region !== process.env.AWS_REGION);

  const promises = [];

  promises.push(...regions
    .map(async region => {
      const lambda = new AWS.Lambda({ region });

      try {
        await lambda.deleteFunction({
          FunctionName: 'stackery-agent-commander'
        }).promise();

        console.log(`Deleted stackery-agent-commander function in region ${region}`);
      } catch (err) {
        console.log(`Failed to delete stackery-agent-commander function in region ${region}: (${err.code}) ${err.message}`);
      }
    }));

  promises.push(...regions
    .map(async region => {
      const sns = new AWS.SNS({ region });

      try {
        await sns.deleteTopic({
          TopicArn: `arn:aws:sns:${region}:${process.env.AWS_ACCOUNT_ID}:StackeryCloudFormationNotifications`
        }).promise();

        console.log(`Deleted StackeryCloudFormationNotifications topic in region ${region}`);
      } catch (err) {
        console.log(`Failed to delete StackeryCloudFormationNotifications topic in region ${region}: (${err.code}) ${err.message}`);
      }
    }));

  await Promise.all(promises);

  await sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message);
}
