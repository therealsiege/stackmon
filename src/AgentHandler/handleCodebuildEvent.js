const sendProvisionResponse = require('./sendProvisionResponse');

module.exports = async message => {
  const detail = message.detail;
  const projectName = detail['project-name'];
  const buildId = detail['build-id'].split('/')[1];
  const consoleLink = `https://${process.env.AWS_REGION}.console.aws.amazon.com/codesuite/codebuild/projects/${projectName}/build/${buildId}/log?region=${process.env.AWS_REGION}`;

  // Organize env vars in a more consumable format
  const environmentVariables = detail['additional-information'].environment['environment-variables'];
  const map = {};

  for (let i = 0; i < environmentVariables.length; i++) {
    const item = environmentVariables[i];
    const name = item.name;
    const value = item.value;
    map[name] = value;
  }

  const body = {
    ResponseURL: map.CFN_RESPONSE_URL,
    StackId: map.CFN_STACK_ID,
    LogicalResourceId: map.CFN_LOGICAL_ID,
    RequestId: map.CFN_REQUEST_ID
  };

  let missingCFParams = false;

  try {
    if (!map.CFN_RESPONSE_URL || !map.CFN_STACK_ID || !map.CFN_LOGICAL_ID || !map.CFN_REQUEST_ID) {
      missingCFParams = true;
      throw new Error(`Missing Cloudformation params: ${JSON.stringify(body, null, 2)}`);
    }

    switch (detail['build-status']) {
      case 'SUCCEEDED':
        return sendProvisionResponse(map.SOURCE_VERSION, null, 'SUCCESS', body);

      case 'FAULT':
      case 'TIMED_OUT':
      case 'FAILED':
      case 'STOPPED':
        return sendProvisionResponse(map.SOURCE_VERSION, null, 'FAILED', body, `Failed to publish site, see ${consoleLink}`);
      default:
        throw new Error(`Unrecognized build status: ${detail['build-status']}`);
    }
  } catch (error) {
    console.log(`Failed to handle CodeBuild event: ${error.message}`);

    if (missingCFParams) {
      throw error;
    } else {
      return sendProvisionResponse(
        map.SOURCE_VERSION || 'resource',
        null,
        'FAILED',
        body,
        error.message
      );
    }
  }
};
