// Copyright 2018-2020 Stackery, Inc. All Rights Reserved.

const url = require('url');
const AWS = require('aws-sdk');
const sendProvisionRecord = require('../sendProvisionRecord');
const sendProvisionResponse = require('../sendProvisionResponse');
const recordTypes = require('../recordTypes');

module.exports.provision = async message => {
  switch (message.RequestType) {
    case 'Create':
      return provisionEdgeFunctionCreate(message);

    case 'Update':
      return provisionEdgeFunctionUpdate(message);

    case 'Delete':
      return provisionEdgeFunctionDelete(message);

    default:
      throw new Error(`Invalid CloudFormation custom resource RequestType '${message.RequestType}'`);
  }
};

async function provisionEdgeFunctionCreate (message) {
  const lambda = new AWS.Lambda({ region: 'us-east-1' });

  let FunctionName;
  let FunctionArn;
  let Version;

  try {
    ({ FunctionName, FunctionArn, Version } = await lambda.createFunction({
      Code: parseCodeFromS3URL(message.ResourceProperties.CodeUri),
      FunctionName: message.ResourceProperties.FunctionName,
      Handler: message.ResourceProperties.Handler,
      Role: message.ResourceProperties.Role,
      Runtime: message.ResourceProperties.Runtime,
      Description: message.ResourceProperties.Description || '',
      MemorySize: message.ResourceProperties.MemorySize || 128,
      Publish: true,
      Timeout: message.ResourceProperties.Timeout || 3,
      TracingConfig: {
        Mode: message.ResourceProperties.Tracing || 'PassThrough'
      }
    }).promise());
  } catch (err) {
    throw new Error(`Failed to create CDN Function: ${err.message}`);
  }

  const attributes = {
    Arn: FunctionArn,
    Version,
    VersionArn: `${FunctionArn}:${Version}`
  };

  await sendProvisionResponse(FunctionName, attributes, 'SUCCESS', message);
}

async function provisionEdgeFunctionUpdate (message) {
  const lambda = new AWS.Lambda({ region: 'us-east-1' });

  if (message.ResourceProperties.FunctionName !== message.PhysicalResourceId) {
    return provisionEdgeFunctionCreate(message);
  }

  let FunctionName;
  let FunctionArn;
  let Version;

  try {
    await updateConfiguration(lambda, message.ResourceProperties);
  } catch (err) {
    throw new Error(`Failed to update CDN Function configuration: ${err.message}`);
  }

  try {
    ({ FunctionName, FunctionArn, Version } = await lambda.updateFunctionCode({
      FunctionName: message.OldResourceProperties.FunctionName,
      ...parseCodeFromS3URL(message.ResourceProperties.CodeUri),
      Publish: true
    }).promise());
  } catch (err) {
    try {
      await updateConfiguration(lambda, message.OldResourceProperties);
    } catch (err) {
      console.log(`Failed to roll back CDN Function configuration: ${err.message}`);
    }

    throw new Error(`Failed to update CDN Function code: ${err.message}`);
  }

  /* The returned FunctionArn from updateFunctionCode has the version in it
   * (unlike createFunction) */
  const attributes = {
    Arn: FunctionArn.replace(/:\d+$/, ''),
    Version,
    VersionArn: FunctionArn
  };

  await sendProvisionResponse(FunctionName, attributes, 'SUCCESS', message);
}

async function provisionEdgeFunctionDelete (message) {
  const lambda = new AWS.Lambda({ region: 'us-east-1' });

  try {
    await lambda.deleteFunction({
      FunctionName: message.PhysicalResourceId
    }).promise();
  } catch (err) {
    // Replicated Lambda@Edge functions can't be deleted until CloudFront has finished
    // deleteting the replicas. If it can't be deleted yet we make a provision check record
    // so as to retry later.
    if (err.code === 'InvalidParameterValueException' && err.message.includes('replicated function')) {
      if (message.type === recordTypes.LAMBDA_EDGE_FUNCTION_DELETE) {
        // This was already a retry attempt; throw to continue retrying
        throw new Error(`Failed to delete edge function ${message.PhysicalResourceId} due to replication, will retry`);
      }
      await sendProvisionRecord({ type: recordTypes.LAMBDA_EDGE_FUNCTION_DELETE }, message);
      return;
    }

    // If the function doesn't exist, respond successfully. If the function previously failed to delete
    // due to a replication issue but is now failing to delete for some other reason, fail the delete
    // operation and stop retrying.
    if (err.code !== 'ResourceNotFoundException') {
      if (message.type === recordTypes.LAMBDA_EDGE_FUNCTION_DELETE) {
        await sendProvisionResponse(message.PhysicalResourceId, null, 'FAILED', message, err.message);
        return;
      }
      throw new Error(`Failed to delete CDN Function: ${err.message}`);
    }
  }

  await sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message);
}

async function updateConfiguration (lambda, properties) {
  await lambda.updateFunctionConfiguration({
    FunctionName: properties.FunctionName,
    Handler: properties.Handler,
    Role: properties.Role,
    Runtime: properties.Runtime,
    Description: properties.Description || '',
    MemorySize: properties.MemorySize || 128,
    Timeout: properties.Timeout || 3,
    TracingConfig: {
      Mode: properties.Tracing || 'PassThrough'
    }
  }).promise();
}

function parseCodeFromS3URL (s3Url) {
  // url has been deprecated
  // eslint-disable-next-line
  s3Url = url.parse(s3Url);

  return {
    S3Bucket: s3Url.host,
    S3Key: s3Url.path.slice(1)
  };
}

// Retry an edge function operation
module.exports.check = async (record, timestamp) => {
  switch (record.type) {
    case recordTypes.LAMBDA_EDGE_FUNCTION_DELETE:
      return provisionEdgeFunctionDelete(record);
    default:
      throw new Error(`Unexpected check type ${record.type}`);
  }
};
