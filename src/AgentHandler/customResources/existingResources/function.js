// Copyright 2018 Stackery, Inc. All Rights Reserved.

const sendProvisionResponse = require('../../sendProvisionResponse');

const FUNCTION_ARN_RE = /^arn:[^:]+:lambda:[^:]+:[0-9]+:function:(.+)$/;
module.exports = async (message) => {
  const arn = message.ResourceProperties.Data;

  if (typeof arn !== 'string') {
    throw new Error(`Invalid existing Lambda Function data: data must be an AWS ARN string`);
  }

  let functionName;
  try {
    let _; // eslint-disable-line no-unused-vars
    [ _, functionName ] = arn.match(FUNCTION_ARN_RE);
  } catch (err) {
    throw new Error(`Invalid existing Lambda Function data: data is not a valid Lambda Function ARN (${arn})`);
  }

  const attributes = { Arn: arn };

  await sendProvisionResponse(functionName, attributes, 'SUCCESS', message);
};
