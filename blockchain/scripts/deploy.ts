import { ethers } from "hardhat";

async function main() {
  console.log("Deploying GuardianLog contract...");

  const guardianLog = await ethers.deployContract("GuardianLog");

  await guardianLog.waitForDeployment();
  
  const contractAddress = await guardianLog.getAddress();

  console.log(`✅ GuardianLog contract deployed to Amoy testnet at: ${contractAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});