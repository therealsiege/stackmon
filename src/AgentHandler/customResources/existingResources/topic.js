// Copyright 2018 Stackery, Inc. All Rights Reserved.

const sendProvisionResponse = require('../../sendProvisionResponse');

const TOPIC_ARN_RE = /^arn:[^:]+:sns:[^:]+:[0-9]+:(.+)$/;
module.exports = async (message) => {
  const arn = message.ResourceProperties.Data;

  if (typeof arn !== 'string') {
    throw new Error(`Invalid existing SNS Topic data: data must be an AWS ARN string`);
  }

  let topicName;
  try {
    let _; // eslint-disable-line no-unused-vars
    [ _, topicName ] = arn.match(TOPIC_ARN_RE);
  } catch (err) {
    throw new Error(`Invalid existing SNS Topic data: data is not a valid SNS Topic ARN (${arn})`);
  }

  const attributes = { TopicName: topicName };

  await sendProvisionResponse(arn, attributes, 'SUCCESS', message);
};
