//! Logos Execution Zone (LEZ) Trail Registry Smart Contract
//! Version: 0.1.0 (trails.logos PRD)

use borsh::{BorshDeserialize, BorshSerialize};

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct Capabilities {
    pub has_photos: bool,
    pub has_videos: bool,
    pub has_voice: bool,
    pub has_text: bool,
    pub has_geographic_path: bool,
    pub has_local_spatial_path: bool,
    pub has_spatial_geometry: bool,
    pub has_plan: bool,
    pub has_alignment_assets: bool,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct RegistryConfig {
    pub schema_version: String,
    pub administrator_account: [u8; 32],
    pub authorised_publisher_account: [u8; 32],
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct TrailPublication {
    pub trail_id: String,
    pub publisher_account: [u8; 32],
    pub current_revision: u32,
    pub package_cid: String,
    pub package_size_bytes: u64,
    pub package_format_version: String,
    pub title: String,
    pub short_description: Option<String>,
    pub recorded_at: String,
    pub capabilities: Capabilities,
    pub listed: bool,
    pub created_at_block: u64,
    pub updated_at_block: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct TrailRevision {
    pub trail_id: String,
    pub revision: u32,
    pub package_cid: String,
    pub package_size_bytes: u64,
    pub operation_id: String,
    pub published_at_block: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum RegistryInstruction {
    Initialise {
        administrator_account: [u8; 32],
        authorised_publisher_account: [u8; 32],
    },
    RegisterTrail {
        operation_id: String,
        trail_id: String,
        package_cid: String,
        package_size_bytes: u64,
        title: String,
        short_description: Option<String>,
        recorded_at: String,
        capabilities: Capabilities,
    },
    PublishRevision {
        operation_id: String,
        trail_id: String,
        expected_revision: u32,
        next_package_cid: String,
        next_package_size_bytes: u64,
        title: String,
        short_description: Option<String>,
        capabilities: Capabilities,
    },
    SetListed {
        operation_id: String,
        trail_id: String,
        listed: bool,
    },
}

#[derive(BorshSerialize, BorshDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum RegistryError {
    AlreadyInitialised,
    NotInitialised,
    Unauthorized,
    TrailAlreadyExists,
    TrailNotFound,
    RevisionMismatch,
    OperationConflict,
}

pub struct TrailsRegistryState {
    pub config: Option<RegistryConfig>,
    pub publications: Vec<TrailPublication>,
    pub revisions: Vec<TrailRevision>,
    pub processed_operations: Vec<(String, String)>, // (operation_id, trail_id)
}

impl TrailsRegistryState {
    pub fn new() -> Self {
        Self {
            config: None,
            publications: Vec::new(),
            revisions: Vec::new(),
            processed_operations: Vec::new(),
        }
    }

    pub fn process_instruction(
        &mut self,
        instruction: RegistryInstruction,
        caller: [u8; 32],
        block_height: u64,
    ) -> Result<(), RegistryError> {
        match instruction {
            RegistryInstruction::Initialise {
                administrator_account,
                authorised_publisher_account,
            } => {
                if self.config.is_some() {
                    return Err(RegistryError::AlreadyInitialised);
                }
                self.config = Some(RegistryConfig {
                    schema_version: "1.0.0".to_string(),
                    administrator_account,
                    authorised_publisher_account,
                });
                Ok(())
            }
            RegistryInstruction::RegisterTrail {
                operation_id,
                trail_id,
                package_cid,
                package_size_bytes,
                title,
                short_description,
                recorded_at,
                capabilities,
            } => {
                let config = self.config.as_ref().ok_or(RegistryError::NotInitialised)?;
                if caller != config.authorised_publisher_account {
                    return Err(RegistryError::Unauthorized);
                }

                // Check idempotency by operation_id
                if let Some((_, existing_tid)) = self
                    .processed_operations
                    .iter()
                    .find(|(op, _)| op == &operation_id)
                {
                    if existing_tid == &trail_id {
                        return Ok(()); // idempotent retry
                    }
                    return Err(RegistryError::OperationConflict);
                }

                if self.publications.iter().any(|p| p.trail_id == trail_id) {
                    return Err(RegistryError::TrailAlreadyExists);
                }

                self.publications.push(TrailPublication {
                    trail_id: trail_id.clone(),
                    publisher_account: caller,
                    current_revision: 1,
                    package_cid: package_cid.clone(),
                    package_size_bytes,
                    package_format_version: "0.1.0".to_string(),
                    title,
                    short_description,
                    recorded_at,
                    capabilities,
                    listed: true,
                    created_at_block: block_height,
                    updated_at_block: block_height,
                });

                self.revisions.push(TrailRevision {
                    trail_id: trail_id.clone(),
                    revision: 1,
                    package_cid,
                    package_size_bytes,
                    operation_id: operation_id.clone(),
                    published_at_block: block_height,
                });

                self.processed_operations
                    .push((operation_id, trail_id));

                Ok(())
            }
            RegistryInstruction::PublishRevision {
                operation_id,
                trail_id,
                expected_revision,
                next_package_cid,
                next_package_size_bytes,
                title,
                short_description,
                capabilities,
            } => {
                let config = self.config.as_ref().ok_or(RegistryError::NotInitialised)?;
                if caller != config.authorised_publisher_account {
                    return Err(RegistryError::Unauthorized);
                }

                // Idempotency check
                if let Some((_, existing_tid)) = self
                    .processed_operations
                    .iter()
                    .find(|(op, _)| op == &operation_id)
                {
                    if existing_tid == &trail_id {
                        return Ok(());
                    }
                    return Err(RegistryError::OperationConflict);
                }

                let pub_record = self
                    .publications
                    .iter_mut()
                    .find(|p| p.trail_id == trail_id)
                    .ok_or(RegistryError::TrailNotFound)?;

                if pub_record.current_revision != expected_revision {
                    return Err(RegistryError::RevisionMismatch);
                }

                let new_rev = expected_revision + 1;
                pub_record.current_revision = new_rev;
                pub_record.package_cid = next_package_cid.clone();
                pub_record.package_size_bytes = next_package_size_bytes;
                pub_record.title = title;
                pub_record.short_description = short_description;
                pub_record.capabilities = capabilities;
                pub_record.updated_at_block = block_height;

                self.revisions.push(TrailRevision {
                    trail_id: trail_id.clone(),
                    revision: new_rev,
                    package_cid: next_package_cid,
                    package_size_bytes: next_package_size_bytes,
                    operation_id: operation_id.clone(),
                    published_at_block: block_height,
                });

                self.processed_operations
                    .push((operation_id, trail_id));

                Ok(())
            }
            RegistryInstruction::SetListed {
                operation_id,
                trail_id,
                listed,
            } => {
                let config = self.config.as_ref().ok_or(RegistryError::NotInitialised)?;
                if caller != config.authorised_publisher_account {
                    return Err(RegistryError::Unauthorized);
                }

                let pub_record = self
                    .publications
                    .iter_mut()
                    .find(|p| p.trail_id == trail_id)
                    .ok_or(RegistryError::TrailNotFound)?;

                pub_record.listed = listed;
                pub_record.updated_at_block = block_height;

                self.processed_operations
                    .push((operation_id, trail_id));

                Ok(())
            }
        }
    }

    pub fn get_trail(&self, trail_id: &str) -> Option<&TrailPublication> {
        self.publications.iter().find(|p| p.trail_id == trail_id)
    }

    pub fn get_revision(&self, trail_id: &str, revision: u32) -> Option<&TrailRevision> {
        self.revisions
            .iter()
            .find(|r| r.trail_id == trail_id && r.revision == revision)
    }

    pub fn list_trails(&self, cursor: usize, limit: usize) -> Vec<&TrailPublication> {
        self.publications
            .iter()
            .filter(|p| p.listed)
            .skip(cursor)
            .take(limit)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_capabilities() -> Capabilities {
        Capabilities {
            has_photos: true,
            has_videos: false,
            has_voice: true,
            has_text: true,
            has_geographic_path: true,
            has_local_spatial_path: true,
            has_spatial_geometry: false,
            has_plan: false,
            has_alignment_assets: false,
        }
    }

    #[test]
    fn test_full_registry_lifecycle() {
        let mut registry = TrailsRegistryState::new();
        let admin = [1u8; 32];
        let publisher = [2u8; 32];

        // 1. Initialise
        registry
            .process_instruction(
                RegistryInstruction::Initialise {
                    administrator_account: admin,
                    authorised_publisher_account: publisher,
                },
                admin,
                1,
            )
            .unwrap();

        // 2. Register Trail
        registry
            .process_instruction(
                RegistryInstruction::RegisterTrail {
                    operation_id: "op_001".to_string(),
                    trail_id: "trail_sunset_ridge".to_string(),
                    package_cid: "cid_sha256_aaa111".to_string(),
                    package_size_bytes: 524288,
                    title: "Sunset Ridge Trail".to_string(),
                    short_description: Some("Scenic coastal ridge walk".to_string()),
                    recorded_at: "2026-10-29T12:00:00Z".to_string(),
                    capabilities: dummy_capabilities(),
                },
                publisher,
                10,
            )
            .unwrap();

        let trail = registry.get_trail("trail_sunset_ridge").unwrap();
        assert_eq!(trail.current_revision, 1);
        assert_eq!(trail.package_cid, "cid_sha256_aaa111");
        assert_eq!(trail.listed, true);

        // 3. Idempotent Retry of same operationId
        registry
            .process_instruction(
                RegistryInstruction::RegisterTrail {
                    operation_id: "op_001".to_string(),
                    trail_id: "trail_sunset_ridge".to_string(),
                    package_cid: "cid_sha256_aaa111".to_string(),
                    package_size_bytes: 524288,
                    title: "Sunset Ridge Trail".to_string(),
                    short_description: Some("Scenic coastal ridge walk".to_string()),
                    recorded_at: "2026-10-29T12:00:00Z".to_string(),
                    capabilities: dummy_capabilities(),
                },
                publisher,
                11,
            )
            .unwrap();

        // 4. Publish Revision 2
        registry
            .process_instruction(
                RegistryInstruction::PublishRevision {
                    operation_id: "op_002".to_string(),
                    trail_id: "trail_sunset_ridge".to_string(),
                    expected_revision: 1,
                    next_package_cid: "cid_sha256_bbb222".to_string(),
                    next_package_size_bytes: 600000,
                    title: "Sunset Ridge Trail (Updated)".to_string(),
                    short_description: Some("Updated with voice notes".to_string()),
                    capabilities: dummy_capabilities(),
                },
                publisher,
                20,
            )
            .unwrap();

        let trail_v2 = registry.get_trail("trail_sunset_ridge").unwrap();
        assert_eq!(trail_v2.current_revision, 2);
        assert_eq!(trail_v2.package_cid, "cid_sha256_bbb222");

        // Verify revision 1 was preserved
        let rev1 = registry.get_revision("trail_sunset_ridge", 1).unwrap();
        assert_eq!(rev1.package_cid, "cid_sha256_aaa111");

        // 5. Unlist and list
        registry
            .process_instruction(
                RegistryInstruction::SetListed {
                    operation_id: "op_003".to_string(),
                    trail_id: "trail_sunset_ridge".to_string(),
                    listed: false,
                },
                publisher,
                30,
            )
            .unwrap();

        assert_eq!(registry.list_trails(0, 10).len(), 0);

        registry
            .process_instruction(
                RegistryInstruction::SetListed {
                    operation_id: "op_004".to_string(),
                    trail_id: "trail_sunset_ridge".to_string(),
                    listed: true,
                },
                publisher,
                31,
            )
            .unwrap();

        assert_eq!(registry.list_trails(0, 10).len(), 1);
    }
}
