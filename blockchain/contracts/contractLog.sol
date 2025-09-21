// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

/**
 * @title BlockLog
 * @dev A smart contract to store immutable, timestamped evidence logs for BlockSafe.
 * Each log links a cryptographic hash of an off-chain evidence file to its secure storage URL.
 */
contract GuardianLog {

    // Custom data structure to hold the details of an evidence log.
    struct EvidenceLog {
        uint256 id; // Unique ID for each log entry
        uint256 timestamp; // The time the event was recorded
        string evidenceHash; // The SHA-256 hash of the evidence file
        string s3Url; // The secure URL where the evidence file is stored in AWS S3
        address loggedBy; // The address that logged this event (our backend server's wallet)
    }

    uint256 private _logCounter;

    // A mapping that links a log ID (a number) to its EvidenceLog struct.
    // This acts like our on-chain database.
    mapping(uint256 => EvidenceLog) public evidenceLogs;

    // An event that is broadcast on the blockchain after a new log is successfully created.
    event EvidenceLogged(uint256 indexed id, string evidenceHash, string s3Url);

    /**
     * @dev Public function to log new evidence. This is the function our backend will call.
     * @param _evidenceHash The SHA-256 hash of the off-chain evidence file.
     * @param _s3Url The URL of the evidence file in AWS S3.
     * @param _gpsCoordinates A string containing the GPS coordinates.
     */
    function logEvidence(
        string memory _evidenceHash, 
        string memory _s3Url,
        string memory _gpsCoordinates // We can add this to the struct later if needed
    ) public {
        _logCounter++;

        // Create a new EvidenceLog struct and store it in our mapping
        evidenceLogs[_logCounter] = EvidenceLog(
            _logCounter,
            block.timestamp, // Use the secure blockchain timestamp
            _evidenceHash,
            _s3Url,
            msg.sender // The address that called this function
        );

        // Broadcast the event
        emit EvidenceLogged(_logCounter, _evidenceHash, _s3Url);
    }
}