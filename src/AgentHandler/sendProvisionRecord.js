// Copyright 2018-2020 Stackery, Inc. All Rights Reserved.

/* Send an SQS record to the Provision Checks queue. This will re-call us
 * periodically to check on the status of resources and report back to
 * CloudFormation when everything is good. */

const AWS = require('aws-sdk');

module.exports = async (record, provisionMessage) => {
  const sqs = new AWS.SQS();

  record.ResponseURL = provisionMessage.ResponseURL;
  record.StackId = provisionMessage.StackId;
  record.RequestId = provisionMessage.RequestId;
  record.LogicalResourceId = provisionMessage.LogicalResourceId;
  record.PhysicalResourceId = provisionMessage.PhysicalResourceId;

  const { MessageId } = await sqs.sendMessage({
    QueueUrl: process.env.PROVISION_CHECK_QUEUE_URL,
    MessageBody: JSON.stringify(record)
  }).promise();

  console.log(`Enqueued provision checker record with id ${MessageId}: ${JSON.stringify(record, null, 2)}`);
};
