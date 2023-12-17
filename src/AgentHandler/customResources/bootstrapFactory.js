// Copyright 2018-2020 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');
const fs = require('fs');
const sendProvisionResponse = require('../sendProvisionResponse');
const getCodeBuildTags = require('../getCodeBuildTags');

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

const PROJECT_NAME = 'StackeryFactory';

async function getStackeryFactoryParams (buildspec) {
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
    serviceRole: `arn:aws:iam::${process.env.AWS_ACCOUNT_ID}:role/stackery/stackery-factory-role`,
    source: {
      type: 'NO_SOURCE',
      buildspec: buildspec
    },
    tags: await getCodeBuildTags(PROJECT_NAME)
  };
}

async function createAgentStackeryFactory (message, region) {
  const codebuild = new AWS.CodeBuild({ region });

  const buildspec = fs.readFileSync('./customResources/buildspec.yaml').toString();

  try {
    try {
      await codebuild.deleteProject({ name: PROJECT_NAME }).promise();
    } catch (e) {
      // ignore
    }

    const result = await codebuild.createProject(await getStackeryFactoryParams(buildspec, message.StackId)).promise();
    console.log(`Created StackeryFactory in region ${region}: ${JSON.stringify(result)}`);
  } catch (err) {
    if ((err.code === 'InvalidInputException' || err.code === 'RegionDisabledException') && err.message.includes('STS is not activated in this region')) {
      console.log(`Could not create a stackeryFactory codebuild project in region ${region}: ${err.message} (${err.code})`);
    } else {
      throw new Error(`Error while attempting to create a stackeryFactory codebuild project in region ${region}: ${err.message} (${err.code})`);
    }
  }
}

async function updateAgentStackeryFactory (message, region) {
  const codebuild = new AWS.CodeBuild({ region });

  const buildspec = fs.readFileSync('./customResources/buildspec.yaml').toString();

  try {
    const result = await codebuild.updateProject(await getStackeryFactoryParams(buildspec)).promise();
    console.log(`Updated StackeryFactory in region ${region}: ${JSON.stringify(result)}`);
  } catch (err) {
    if (err.code === 'InvalidInputException' && err.message.includes('STS is not activated in this region')) {
      console.log(`Could not update the stackeryFactory codebuild project in region ${region}: ${err.message} (${err.code})`);
    } else {
      throw new Error(`Error while attempting to update the stackeryFactory codebuild project in region ${region}: ${err.message} (${err.code})`);
    }
  }
}

async function create (message) {
  await Promise.all(message.ResourceProperties.Regions
    .filter(region => region !== process.env.AWS_REGION)
    .map(async region => createAgentStackeryFactory(message, region))
  );

  await sendProvisionResponse('stackery-agent-factories', null, 'SUCCESS', message);
}

async function update (message) {
  const oldRegions = message.ResourceProperties.Regions.filter(region => region !== process.env.AWS_REGION && message.OldResourceProperties.Regions.includes(region));
  const newRegions = message.ResourceProperties.Regions.filter(region => region !== process.env.AWS_REGION && !message.OldResourceProperties.Regions.includes(region));

  await Promise.all(
    newRegions.map(region => createAgentStackeryFactory(message, region))
      .concat(oldRegions.map(region => updateAgentStackeryFactory(message, region)))
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
          name: 'StackeryFactory'
        }).promise();

        console.log(`Deleted StackeryFactory in region ${region}`);
      } catch (err) {
        console.log(`Failed to delete StackeryFactory in region ${region}: (${err.code}) ${err.message}`);
      }
    }));

  await sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message);
}
