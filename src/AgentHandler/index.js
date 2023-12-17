/* Stackery Agent Commander
 *
 * Provisions custom CloudFormation resources for Stackery stacks.
 *
 * Copyright 2018 Stackery, Inc. All Rights Reserved.
 * 
 * Now managed by @therealsiege.
 * 
 * Big thank you to @txase, you helped me tons!!!
 */

const handleCustomResource = require('./handleCustomResource');
const handleRecords = require('./handleRecords');
const handleCodeBuildEvent = require('./handleCodebuildEvent');

module.exports.handler = async message => {
  console.log('Event message:');
  console.log(JSON.stringify(message, null, 2));

  if (message.RequestType) {
    await handleCustomResource(message);
  } else if (Array.isArray(message.Records)) {
    await handleRecords(message.Records);
  } else if (message.source === 'aws.codebuild') {
    await handleCodeBuildEvent(message);
  } else {
    throw new Error(`Unrecognized message:\n${JSON.stringify(message, null, 2)}`);
  }
};
