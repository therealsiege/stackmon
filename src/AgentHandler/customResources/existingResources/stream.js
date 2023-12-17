// Copyright 2018 Stackery, Inc. All Rights Reserved.

const sendProvisionResponse = require('../../sendProvisionResponse');

const STREAM_ARN_RE = /^arn:[^:]+:kinesis:[^:]+:[0-9]+:stream\/(.+)$/;
module.exports = async (message) => {
  const arn = message.ResourceProperties.Data;

  if (typeof arn !== 'string') {
    throw new Error(`Invalid existing Kinesis Stream data: data must be an AWS ARN string`);
  }

  let streamName;
  try {
    let _; // eslint-disable-line no-unused-vars
    [ _, streamName ] = arn.match(STREAM_ARN_RE);
  } catch (err) {
    throw new Error(`Invalid existing Kinesis Stream data: data is not a valid Kinesis Stream ARN (${arn})`);
  }

  const attributes = {
    Arn: arn
  };

  await sendProvisionResponse(streamName, attributes, 'SUCCESS', message);
};
