// Copyright 2020 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');
const fs = require('fs');
const sendProvisionResponse = require('../sendProvisionResponse');
const getCodeBuildTags = require('../getCodeBuildTags');
const getEventBridgeRuleTags = require('../getEventBridgeRuleTags');

module.exports.provision = async message => {
  switch (message.RequestType) {
    case 'Create':
      await create(message);
      break;

    case 'Update':
      await update(message);
      break;

    case 'Delete':
      await del(message);
      break;

    default:
      throw new Error(`Invalid CloudFormation custom resource RequestType '${message.RequestType}'`);
  }
};

const PROJECT_NAME = 'StackeryPipelineRunner';
const EB_RULE_NAME = 'StackeryForwardPipelineEvents';

async function getStackeryPipelineRunnerParams (buildspec, serviceRole) {
  return {
    name: PROJECT_NAME,
    artifacts: {
      type: 'NO_ARTIFACTS'
    },
    environment: {
      type: 'LINUX_CONTAINER',
      computeType: 'BUILD_GENERAL1_SMALL',
      image: 'aws/codebuild/standard:2.0'
    },
    serviceRole,
    source: {
      type: 'NO_SOURCE',
      buildspec: buildspec
    },
    tags: await getCodeBuildTags(PROJECT_NAME)
  };
}

async function createAgentStackeryPipelineRunner (message, region) {
  const {
    AwsAccountId: awsAccountId,
    ServiceRole: serviceRole,
    PipelineRunnerEventsRule: pipelineRunnerEventsRule
  } = message.ResourceProperties;

  const codebuild = new AWS.CodeBuild({ region });
  const buildspec = fs.readFileSync(`${__dirname}/buildspec.yaml`).toString();

  try {
    await codebuild.deleteProject({ name: PROJECT_NAME }).promise();
  } catch (e) {
    // ignore
  }

  let result;
  try {
    result = await codebuild.createProject(await getStackeryPipelineRunnerParams(buildspec, serviceRole)).promise();
  } catch (err) {
    if ((err.code === 'InvalidInputException' || err.code === 'RegionDisabledException') && err.message.includes('STS is not activated in this region')) {
      console.log(`Could not create a stackeryFactory codebuild project in region ${region}: ${err.message} (${err.code})`);
      return;
    } else {
      throw new Error(`Error while attempting to create a stackeryFactory codebuild project in region ${region}: ${err.message} (${err.code})`);
    }
  }

  console.log(`Created StackeryPipelineRunner in region ${region}: ${JSON.stringify(result)}`);

  // Create an EventBridge rule to forward PipelineRunner events to the stackery account in
  // the same region.
  const eventbridge = new AWS.EventBridge({ region });

  try {
    await eventbridge.putRule({
      Name: EB_RULE_NAME,
      Description: 'Forward StackeryPipelineRunner events to the Stackery account in this region',
      EventBusName: 'default',
      EventPattern: JSON.stringify({
        source: ['aws.codebuild'],
        'detail-type': ['CodeBuild Build State Change'],
        detail: {
          'build-status': [
            'FAILED',
            'SUCCEEDED'
          ],
          'project-name': ['StackeryPipelineRunner']
        }
      }),
      State: 'ENABLED',
      Tags: await getEventBridgeRuleTags(pipelineRunnerEventsRule)
    }).promise();

    await eventbridge.putTargets({
      Rule: 'StackeryForwardPipelineEvents',
      Targets: [
        {
          Arn: `arn:aws:events:${region}:${awsAccountId}:event-bus/default`,
          Id: 'StackeryPipelineRunnerEventNotification'
        }
      ]
    }).promise();

    console.log(`Created EventBridge rule in ${region}`);
  } catch (err) {
    console.log('Error create event rule:', err);
    throw err;
  }
}

async function updateAgentStackeryPipelineRunner (message, region) {
  const codebuild = new AWS.CodeBuild({ region });

  const buildspec = fs.readFileSync(`${__dirname}/buildspec.yaml`).toString();
  const serviceRole = message.ResourceProperties.ServiceRole;
  const result = await codebuild.updateProject(await getStackeryPipelineRunnerParams(buildspec, serviceRole, message.StackId)).promise();

  console.log(`Updated StackeryPipelineRunner in region ${region}: ${JSON.stringify(result)}`);
}

async function create (message) {
  await Promise.all(message.ResourceProperties.Regions
    .filter(region => region !== process.env.AWS_REGION)
    .map(async region => createAgentStackeryPipelineRunner(message, region))
  );

  await sendProvisionResponse('stackery-agent-factories', null, 'SUCCESS', message);
}

async function update (message) {
  const oldRegions = message.ResourceProperties.Regions.filter(region => region !== process.env.AWS_REGION && message.OldResourceProperties.Regions.includes(region));
  const newRegions = message.ResourceProperties.Regions.filter(region => region !== process.env.AWS_REGION && !message.OldResourceProperties.Regions.includes(region));

  await Promise.all(
    newRegions.map(region => createAgentStackeryPipelineRunner(message, region))
      .concat(oldRegions.map(region => updateAgentStackeryPipelineRunner(message, region)))
  );

  await sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message);
}

async function del (message) {
  await Promise.all(message.ResourceProperties.Regions
    .filter(region => region !== process.env.AWS_REGION)
    .map(async region => {
      const codebuild = new AWS.CodeBuild({ region });

      try {
        await codebuild.deleteProject({
          name: 'StackeryPipelineRunner'
        }).promise();

        console.log(`Deleted StackeryPipelineRunner in region ${region}`);
      } catch (err) {
        console.log(`Failed to delete StackeryPipelineRunner in region ${region}: (${err.code}) ${err.message}`);
      }

      try {
        const eventbridge = new AWS.EventBridge({ region });

        await eventbridge.removeTargets({
          Ids: ['StackeryPipelineRunnerEventNotification'],
          Rule: 'StackeryForwardPipelineEvents'
        }).promise();

        await eventbridge.deleteRule({
          Name: 'StackeryForwardPipelineEvents'
        }).promise();

        console.log(`Deleted StackeryFowardPipelineEvents in region ${region}`);
      } catch (err) {
        console.log(`Failed to delete StackeryForwardPipelineEvents in region ${region}: (${err.code}) ${err.message}`);
      }
    }));

  await sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message);
}
