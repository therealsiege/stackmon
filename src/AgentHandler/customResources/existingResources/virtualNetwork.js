// Copyright 2018 Stackery, Inc. All Rights Reserved.

const AWS = require('aws-sdk');
const sendProvisionResponse = require('../../sendProvisionResponse');

module.exports = async (message) => {
  let data = message.ResourceProperties.Data;

  // We get JSON stringified values from environment configs
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {
      throw new Error(`Invalid existing VPC data: data from environment config is not valid JSON`);
    }
  }

  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid existing VPC data: data must be an object/dictionary`);
  }

  if (typeof data.VpcId !== 'string') {
    throw new Error(`Invalid existing VPC data: data.VpcId must be a string`);
  }

  if (
    !Array.isArray(data.DefaultPublicSubnetIds) ||
    !data.DefaultPublicSubnetIds.every(subnetId => subnetId && typeof subnetId === 'string')
  ) {
    throw new Error(`Invalid existing VPC data: data.DefaultPublicSubnetIds must be an array of subnet ID strings`);
  }

  if (data.DefaultPublicSubnetIds.length < 2) {
    throw new Error(`Invalid existing VPC data: data.DefaultPublicSubnetIds must have at least two subnet IDs`);
  }

  if (
    !Array.isArray(data.DefaultPrivateSubnetIds) ||
    !data.DefaultPrivateSubnetIds.every(subnetId => subnetId && typeof subnetId === 'string')
  ) {
    throw new Error(`Invalid existing VPC data: data.DefaultPrivateSubnetIds must be an array of subnet ID strings`);
  }

  if (data.DefaultPrivateSubnetIds.length < 2) {
    throw new Error(`Invalid existing VPC data: data.DefaultPrivateSubnetIds must have at least two subnet IDs`);
  }

  const ec2 = new AWS.EC2();

  let defaultSecurityGroup;
  try {
    const { SecurityGroups } = await ec2.describeSecurityGroups({
      Filters: [
        {
          Name: 'vpc-id',
          Values: [ data.VpcId ]
        },
        {
          Name: 'group-name',
          Values: [ 'default' ]
        }
      ]
    }).promise();

    if (SecurityGroups.length < 1) {
      throw new Error(`Failed to find default security group for VPC ${data.VpcId}`);
    }

    defaultSecurityGroup = SecurityGroups[0].GroupId;
  } catch (err) {
    throw new Error(`Error while fetching existing VPC default security group for VPC ${data.VpcId}: ${err.message}`);
  }

  const attributes = {
    DefaultSecurityGroup: defaultSecurityGroup,
    PrivateSubnet1: data.DefaultPrivateSubnetIds[0],
    PrivateSubnet2: data.DefaultPrivateSubnetIds[1],
    PublicSubnet1: data.DefaultPublicSubnetIds[0],
    PublicSubnet2: data.DefaultPublicSubnetIds[1]
  };

  await sendProvisionResponse(data.VpcId, attributes, 'SUCCESS', message);
};
