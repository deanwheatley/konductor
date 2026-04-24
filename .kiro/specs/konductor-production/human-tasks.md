# Human Tasks — AWS Pre-Requisites

These are manual steps you need to complete before the CDK stack and GitHub Actions pipeline can run. Do them in order.

---

## Step 1: Install the AWS CLI

If you don't already have it:

```bash
# macOS (Homebrew)
brew install awscli

# Verify
aws --version
```

Docs: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

---

## Step 2: Create a Deployment IAM User

You need an IAM user (or role) with permissions to create all the resources CDK will provision. This user's credentials will also be used by GitHub Actions.

1. Go to **IAM → Users → Create user**
2. Name: `konductor-deployer` (or whatever you prefer)
3. Attach the following managed policies (broad for POC — tighten later):
   - `AmazonEC2ContainerRegistryFullAccess`
   - `AmazonS3FullAccess`
   - `AmazonSSMFullAccess`
   - `AWSAppRunnerFullAccess`
   - `IAMFullAccess` (CDK needs this to create roles)
   - `AWSCloudFormationFullAccess`
4. Create an **access key** (CLI use case) and save the `Access Key ID` and `Secret Access Key`



Alternatively, if you already have an admin-level IAM user or SSO profile configured, you can use that.

---

## Step 3: Configure AWS CLI

```bash
aws configure
```

Enter:
- **AWS Access Key ID**: from Step 2
- **AWS Secret Access Key**: from Step 2
- **Default region**: your target region (e.g. `us-west-1`)
- **Default output format**: `json`

Verify it works:

```bash
aws sts get-caller-identity
```

You should see your account ID and IAM user ARN.

---

## Step 4: Choose Your API Key

Pick a strong API key that MCP clients will use to authenticate with the production Konductor server. This is the Bearer token in the `Authorization` header.

Example (generate a random one):

```bash
openssl rand -hex 32
```

Save this value — you'll need it for SSM and for configuring clients later.

---

## Step 5: Create a GitHub Personal Access Token

The Konductor server polls GitHub for PR and commit data. You need a PAT with repo read access.

1. Go to https://github.com/settings/tokens (or Fine-grained tokens)
2. Create a token with:
   - **Repository access**: the repos you want Konductor to monitor
   - **Permissions**: `Contents: Read`, `Pull requests: Read`, `Metadata: Read`
3. Copy the token value

---

## Step 6: Create SSM Parameters

These store your secrets in AWS. CDK references them but does not create them.

```bash
# Store the API key
aws ssm put-parameter --name "/konductor/api-key" --type SecureString --value "<your-api-key-from-step-4>"

# Store the GitHub token
aws ssm put-parameter --name "/konductor/github-token" --type SecureString --value "<your-github-pat-from-step-5>"
```

Verify they exist:

```bash
aws ssm get-parameter --name "/konductor/api-key" --with-decryption
aws ssm get-parameter --name "/konductor/github-token" --with-decryption
```

To update later:

```bash
aws ssm put-parameter --name "/konductor/api-key" --type SecureString --value "<new-value>" --overwrite
```

---

## Step 7: Bootstrap CDK

CDK needs a one-time bootstrap in your target account/region. This creates an S3 bucket and IAM roles that CDK uses internally for deployments.

```bash
npx cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/us-west-1
```

You should see output ending with `Environment aws://<account>/<region> bootstrapped.`

---

## Step 8: Add GitHub Actions Secrets

Go to your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

Add these four secrets:

| Secret Name | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | Access key from Step 2 |
| `AWS_SECRET_ACCESS_KEY` | Secret key from Step 2 |
| `AWS_REGION` | Your target region (e.g. `us-west-1`) |
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account ID |

---

## Step 9: Verify Everything

Quick checklist before starting the CDK/pipeline implementation:

```bash
# AWS CLI works
aws sts get-caller-identity

# SSM parameters exist
aws ssm get-parameter --name "/konductor/api-key" --query "Parameter.Name"
aws ssm get-parameter --name "/konductor/github-token" --query "Parameter.Name"

# CDK is bootstrapped
aws cloudformation describe-stacks --stack-name CDKToolkit --query "Stacks[0].StackStatus"
```

All three should return successfully. If any fail, revisit the corresponding step above.

---

## After Deployment

Once the CDK stack is deployed and the first GitHub Actions run completes:

1. **Get the App Runner URL** from the CDK output:
   ```bash
   aws cloudformation describe-stacks --stack-name KonductorStack --query "Stacks[0].Outputs[?OutputKey=='ServiceUrl'].OutputValue" --output text
   ```

2. **Smoke test**:
   ```bash
   curl https://<app-runner-url>/health
   ```

3. **Configure your MCP client** to point at the production URL with your API key from Step 4.

4. **Run the npx installer** in any workspace:
   ```bash
   npx https://<app-runner-url>/bundle/installer.tgz --server https://<app-runner-url>
   ```
