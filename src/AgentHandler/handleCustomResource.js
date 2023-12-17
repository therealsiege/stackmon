// Copyright 2018-2020 Stackery, Inc. All Rights Reserved.

const bootstrap = require('./customResources/bootstrap');
const bootstrapFactory = require('./customResources/bootstrapFactory');
const bootstrapPipelineRunner = require('./customResources/bootstrapPipelineRunner');
const certificate = require('./customResources/certificate');
const stackeryStacksDomain = require('./customResources/stackeryStacksDomain');
const edgeFunction = require('./customResources/edgeFunction');
const existingResource = require('./customResources/existingResource');
const dockerImageBuilderTrigger = require('./customResources/dockerImageBuilderTrigger');
const websiteBuilderTrigger = require('./customResources/websiteBuilderTrigger');
const sendProvisionResponse = require('./sendProvisionResponse');

module.exports = async message => {
  /* Custom resources have timeouts on the order of hours. If a resource fails
   * to deploy, we can look at the logs to at least be able to manually fail the
   * resource action so we can try again quickly. */
  const failureResponse = {
    Status: 'FAILED',
    Reason: 'Manually cancelled',
    PhysicalResourceId: message.PhysicalResourceId || 'resource',
    StackId: message.StackId,
    RequestId: message.RequestId,
    LogicalResourceId: message.LogicalResourceId
  };

  console.log('To forcibly fail this provision, execute this cURL command:');
  console.log(`curl -X PUT '${message.ResponseURL}' -H 'Content-Type:' -d '${JSON.stringify(failureResponse)}'`);

  try {
    switch (message.ResourceType) {
      case 'Custom::StackeryAgentCommanderBootstrap':
        await bootstrap.provision(message);
        break;

      case 'Custom::StackeryAgentFactoryBootstrap':
        await bootstrapFactory.provision(message);
        break;

      case 'Custom::StackeryPipelineRunnerBootstrap':
        await bootstrapPipelineRunner.provision(message);
        break;

      case 'Custom::StackeryUsEast1SSLCertificate':
        await certificate.provision(message);
        break;

      case 'Custom::StackeryStacksDomain':
        await stackeryStacksDomain.provision(message);
        break;

      case 'Custom::StackeryEdgeFunction':
        await edgeFunction.provision(message);
        break;

      case 'Custom::StackeryExistingResource':
        await existingResource.provision(message);
        break;

      case 'Custom::StackeryWebsiteBuildTrigger':
        await websiteBuilderTrigger.provision(message);
        break;

      case 'Custom::StackeryDockerImageBuildTrigger':
        await dockerImageBuilderTrigger.provision(message);
        break;

      default:
        if (message.RequestType === 'Delete') {
          await sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message, `Skipping deletion: custom resource type ${message.ResourceType} is not supported in this Stackery Agent version.`);
        } else {
          throw new Error(`Custom resource type ${message.ResourceType} is not supported in this Stackery Role version. Please update the Stackery Agent in this account to the latest version and try again.`);
        }
    }
  } catch (err) {
    await sendProvisionResponse(
      message.PhysicalResourceId || 'resource',
      null,
      'FAILED',
      message,
      err.message
    );

    throw err;
  }
};
