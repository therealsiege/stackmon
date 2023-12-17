// Copyright 2018 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');
const sendProvisionResponse = require('../../sendProvisionResponse');

const QUEUE_ARN_RE = /^arn:[^:]+:sqs:([^:]+):([0-9]+):(.+)$/;
module.exports = async (message) => {
  const arn = message.ResourceProperties.Data;

  if (typeof arn !== 'string') {
    throw new Error(`Invalid existing SQS Queue data: data must be an AWS ARN string`);
  }

  let region;
  let awsAccountId;
  let queueName;
  try {
    let _; // eslint-disable-line no-unused-vars
    [ _, region, awsAccountId, queueName ] = arn.match(QUEUE_ARN_RE);
  } catch (err) {
    throw new Error(`Invalid existing SQS Queue data: data is not a valid SQS Queue ARN (${arn})`);
  }

  const sqs = new AWS.SQS({ region });

  let QueueUrl;
  try {
    ({ QueueUrl } = await sqs.getQueueUrl({
      QueueName: queueName,
      QueueOwnerAWSAccountId: awsAccountId
    }).promise());
  } catch (err) {
    throw new Error(`Error while fetching existing SQS Queue URL for queue ${queueName} from account ${awsAccountId}: ${err.message}`);
  }

  const attributes = {
    Arn: arn,
    QueueName: queueName
  };

  await sendProvisionResponse(QueueUrl, attributes, 'SUCCESS', message);
};
