// Copyright 2018 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');
const sendProvisionRecord = require('../sendProvisionRecord');
const sendProvisionResponse = require('../sendProvisionResponse');
const recordTypes = require('../recordTypes');

/* Manage a certificate in the us-east-1 region, which is required for API
 * Gateway custom domains. */
module.exports.provision = async message => {
  switch (message.RequestType) {
    case 'Create':
      return provisionCertificateCreate(message);

    case 'Update':
      return provisionCertificateUpdate(message);

    case 'Delete':
      return provisionCertificateDelete(message);

    default:
      throw new Error(`Invalid CloudFormation custom resource RequestType '${message.RequestType}'`);
  }
};

/* Create the certificate. We can't report success back to CF yet, as someone
 * needs to validate the certificate for the custom domain. We create a
 * provision checker record to periodically check the status of the certificate.
 * Once the checker sees that it's been issued it will tell CF. */
async function provisionCertificateCreate (message) {
  const acm = new AWS.ACM({ region: 'us-east-1' });

  const { CertificateArn } = await acm.requestCertificate({
    DomainName: message.ResourceProperties.DomainName,
    DomainValidationOptions: message.ResourceProperties.DomainValidationOptions
  }).promise();

  if (Array.isArray(message.ResourceProperties.Tags) && message.ResourceProperties.Tags.length > 0) {
    try {
      await acm.addTagsToCertificate({
        CertificateArn,
        Tags: message.ResourceProperties.Tags || []
      }).promise();
    } catch (err) {
      console.log(`Failed to add tags to certificate ${CertificateArn}: (${err.code}) ${err.message}`);
      console.log('Deleting certificate...');

      try {
        await acm.deleteCertificate({ CertificateArn }).promise();
      } catch (err) {
        console.log(`Failed to clean up certificate: ${CertificateArn}: (${err.code}) ${err.message}`);
      }

      throw new Error(`Failed to create certificate due to failure to add tags: (${err.code}) ${err.message}`);
    }
  }

  await sendProvisionRecord({ type: recordTypes.US_EAST_1_CERTIFICATE_CREATE, CertArn: CertificateArn }, message);
}

async function provisionCertificateUpdate (message) {
  // If the domain changed we must request a new certificate
  if (
    message.ResourceProperties.DomainName !== message.OldResourceProperties.DomainName ||
    message.ResourceProperties.DomainValidationOptions[0].ValidationDomain !== message.OldResourcePropertiesDomainValidationOptions[0].ValidationDomain
  ) {
    console.log(`Certificate domain or validation domain changed, requesting a new certificate...`);
    await provisionCertificateCreate(message);
    return;
  }

  const acm = new AWS.ACM({ region: 'us-east-1' });

  if (
    message.OldResourceProperties.Tags &&
    Array.isArray(message.OldResourceProperties.Tags) &&
    message.OldResourceProperties.Tags.length > 0
  ) {
    await acm.removeTagsFromCertificate({
      CertificateArn: message.PhysicalResourceId,
      Tags: message.OldResourceProperties.Tags
    }).promise();
  }

  if (
    message.ResourceProperties.Tags &&
    Array.isArray(message.ResourceProperties.Tags) &&
    message.ResourceProperties.Tags.length > 0
  ) {
    await acm.addTagsToCertificate({
      CertificateArn: message.PhysicalResourceId,
      Tags: message.ResourceProperties.Tags || []
    }).promise();
  }

  await sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message);
}

/* Delete the certificate. Often the certificate will fail to be deleted
 * because it is still attached to a shadow CloudFront distribution for an
 * API Gateway custom domain. When that happens, create a provision checker
 * record. The checker will keep trying to delete the certificate. Once it does
 * it will report back to CF. */
async function provisionCertificateDelete (message) {
  const acm = new AWS.ACM({ region: 'us-east-1' });

  try {
    await acm.deleteCertificate({ CertificateArn: message.PhysicalResourceId }).promise();

    await sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message);
  } catch (err) {
    if (err.code === 'ResourceNotFoundException') {
      // If it's already been deleted, ignore the error
      console.log(`Certificate to be deleted not found (${message.PhysicalResourceId}), ignoring error`);
      await sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message);
    } else if (err.code === 'ValidationException') {
      /* If the cert failed to be created, CF may still try to delete it
       * after giving it an invalid physical resource id. */
      console.log(`Failed to delete invalid certificate (${message.PhysicalResourceId}), ignoring error`);
      await sendProvisionResponse(message.PhysicalResourceId, null, 'SUCCESS', message);
    } else if (err.code === 'ResourceInUseException') {
      /* Certificate is still attached to CloudFront distribution, make a
       * provision check record to keep trying to delete it. */
      console.log(`Certificate is still in use, will wait to delete it`);
      await sendProvisionRecord({ type: recordTypes.US_EAST_1_CERTIFICATE_DELETE, CertArn: message.PhysicalResourceId }, message);
    } else {
      err.message = `Failed to delete ACM certificate ${message.PhysicalResourceId}: ${err.message}`;
      throw err;
    }
  }
}

// Check to see if certificate has been issued or if it can be deleted
module.exports.check = async (record, timestamp) => {
  if (record.type === recordTypes.US_EAST_1_CERTIFICATE_CREATE) {
    return checkUSEast1CertCreation(record, timestamp);
  } else {
    return checkUSEast1CertDeletion(record, timestamp);
  }
};

// Check if the certificate has been validated and issued
const checkUSEast1CertCreation = async (record, timestamp) => {
  const acm = new AWS.ACM({ region: 'us-east-1' });

  /* If we've taken more than an hour to check the certificate, CloudFormation
   * has already failed the resource. Ignore this record and return successfully
   * to remove it from the SQS queue. */
  if (Date.now() - timestamp > 60 * 60 * 1000) {
    console.log(`Waited over one hour for certificate to validate, deleting certificate ${record.CertArn} as CloudFormation will have marked it as failed to provision`);

    try {
      await acm.deleteCertificate({ CertificateArn: record.CertArn }).promise();
    } catch (err) {
      console.log(`Failed to clean up certificate: (${err.code}) ${err.message}`);
    }

    return;
  }

  let certificate;
  try {
    const data = await acm.describeCertificate({CertificateArn: record.CertArn}).promise();
    certificate = data.Certificate;
  } catch (err) {
    console.log(`Failed to query status of new certificate ${record.CertArn}: (${err.code}) ${err.message}`);
    await sendProvisionResponse(record.CertArn, null, 'FAILED', record, `Failed to query status of new certificate: (${err.code}) ${err.message}`);
    return;
  }

  switch (certificate.Status) {
    case 'ISSUED':
      console.log(`Succesfully provisioned SSL certificate ${record.CertArn}`);
      await sendProvisionResponse(record.CertArn, null, 'SUCCESS', record);
      break;

    case 'PENDING_VALIDATION':
      // No need to do anything, keep waiting, but this requires throwing a error so the SQS record remais
      throw new Error(`Still awaiting validation for certificate ${record.CertArn}`);

    case 'VALIDATION_TIMED_OUT':
      console.log(`Validation timed out for certificate ${record.CertArn}, reporting failure`);
      await sendProvisionResponse(record.CertArn, null, 'FAILED', record, 'Certificate validation timed out');
      break;

    default:
      console.log(`Invalid cert state for ${record.CertArn}, reporting failure`);
      await sendProvisionResponse(record.CertArn, null, 'FAILED', record, `Certificate created in invalid state: ${certificate.Status}`);
      try {
        await acm.deleteCertificate({CertificateArn: record.CertArn}).promise();
      } catch (err) {
        console.log(`Failed to cleanup certificate: (${err.code}) ${err.message}`);
      }
  }
};

/* Try to delete the certificate. It may fail because it's still attached to a
 * shadow CloudFront distribution for an API Gateway custom domain. If it does,
 * just leave it and we'll try again a minute later. */
const checkUSEast1CertDeletion = async (record, timestamp) => {
  /* If we've taken more than an hour to check the certificate, CloudFormation
   * has already failed the resource. Ignore this record and return successfully
   * to remove it from the SQS queue. */
  if (Date.now() - timestamp > 60 * 60 * 1000) {
    console.log(`Waited over one hour to delete certificate ${record.CertArn}, stopping attempts as CloudFormation will have marked it as failed to delete`);
    return;
  }

  const acm = new AWS.ACM({ region: 'us-east-1' });

  try {
    await acm.deleteCertificate({CertificateArn: record.CertArn}).promise();

    console.log(`Succesfully deleted certificate ${record.CertArn}`);
    await sendProvisionResponse(record.CertArn, null, 'SUCCESS', record);
  } catch (err) {
    if (err.code === 'ResourceNotFoundException') {
      console.log(`Certificate ${record.CertArn} already deleted`);
      await sendProvisionResponse(record.CertArn, null, 'SUCCESS', record);
    } else if (err.code === 'ResourceInUseException') {
      // No need to do anything, keep waiting, but this requires throwing a error so the SQS record remais
      throw new Error(`Failed to delete certificate ${record.CertArn} because it is still in use, will retry`);
    } else {
      console.log(`Failed to delete certificate ${record.CertArn}: (${err.code}) ${err.message}`);
      await sendProvisionResponse(record.CertArn, null, 'FAILED', record, `Failed to delete certificate: (${err.code}) ${err.message}`);
    }
  }
};
