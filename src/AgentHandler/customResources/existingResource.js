// Copyright 2018 Stackery, Inc. All Rights Reserved.

const sendProvisionResponse = require('../sendProvisionResponse');

module.exports.provision = async message => {
  switch (message.RequestType) {
    case 'Create':
    case 'Update':
      await handleExistingResource(message);
      break;

    case 'Delete':
      await sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message);
      break;

    default:
      throw new Error(`Invalid CloudFormation custom resource RequestType '${message.RequestType}'`);
  }
};

const STACK_INFO_RE = /^arn:aws:cloudformation:([^:]+):(\d+):stack\/([^/]+)\/(.+)$/;
const handleExistingResource = async message => {
  const match = message.StackId.match(STACK_INFO_RE);
  if (!match) {
    throw new Error(`Stackery internal error: failed to parse CloudFormation stack ID (${message.StackId})`);
  }

  const stackInfo = {
    region: match[1],
    accountId: match[2],
    name: match[3],
    id: match[4]
  };

  if (!message.ResourceProperties.Type) {
    throw new Error(`Missing existing resource type`);
  }

  let handler;
  try {
    handler = require(`./existingResources/${message.ResourceProperties.Type}`);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error(`Using existing resources for ${message.ResourceProperties.Type} types is not supported in this Stackery Agent version. Please update the Stackery Agent in this account to the latest version and try again.`);
    } else {
      throw new Error(`Failed to require existing resource handler ./existingResources/${message.ResourceProperties.Type}: ${err.message}`);
    }
  }

  await handler(message, stackInfo);
};
