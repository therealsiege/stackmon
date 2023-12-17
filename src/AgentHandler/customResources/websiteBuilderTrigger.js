// Copyright 2020 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');
const sendProvisionResponse = require('../sendProvisionResponse');

module.exports.provision = async message => {
  switch (message.RequestType) {
    case 'Create':
    case 'Update':
      if (!message.ResourceProperties.SourceVersion) {
        console.log('Skipping website build: Local deployment strategy not supported for website resource type');
        // Physical resource id is null in this case
        return sendProvisionResponse('resource', null, 'SUCCESS', message);
      } else {
        return startWebsiteBuilder(message);
      }

    case 'Delete':
      return sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message);

    default:
      throw new Error(`Invalid CloudFormation custom resource RequestType '${message.RequestType}'`);
  }
};

const startWebsiteBuilder = async message => {
  const codebuild = new AWS.CodeBuild();

  try {
    await codebuild.startBuild({
      projectName: message.ResourceProperties.ProjectName,
      environmentVariablesOverride: [
        {
          name: 'CFN_STACK_ID',
          value: message.StackId
        },
        {
          name: 'CFN_REQUEST_ID',
          value: message.RequestId
        },
        {
          name: 'CFN_LOGICAL_ID',
          value: message.LogicalResourceId
        },
        {
          name: 'CFN_RESPONSE_URL',
          value: message.ResponseURL
        },
        {
          name: 'SOURCE_VERSION',
          value: message.ResourceProperties.SourceVersion
        }
      ]
    }).promise();
  } catch (err) {
    throw new Error(`Failed to start Website Builder CodeBuild project: ${err.message}`);
  }
};
