# 🥞 Stackmon
The agent commander for use with CloudFormation and [Stackery VS Code extension](https://docs.stackery.io/docs/using-stackery/introduction). 
Maintained for those who still leverage [Stackery](https://docs.stackery.io/docs/using-stackery/introduction) as a serverless dependency.

![Hero](https://www.stackery.io/static/hero-5e2c073205ae6b27a771a834175d9b21.svg)

Possible reasons for using this utility:

1. Stackery is a dependency to your cloud infrastructure, and you have not moved to a new setup,
2. You want to deploy into customer AWS accounts using AWS SDK.
3. You want to share resources between CloudFormation Stacks with dynamic naming. `Type: Custom::StackeryExistingResource`.

## 🤖 Usage

The fastest way to leverage the agent is to replace your stackery agent commander with the one in this repo. If you'd like more control, the source files are included along with a github action that deploys the lambda.
1. Make and test your changes.
2. Deploy a zip to S3 and reference it in the Stackmon commander `template.yaml`.

## ⌨️ Contributing

Improvements welcome, please make a PR with a basic description.
