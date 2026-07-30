-- ============================================================================
-- Migration 000008: Add newly tracked integration and ballerina repositories
-- ============================================================================
-- asset_prefixes values are verified against each repo's actual GitHub release
-- asset names (historical and current). Note the following prefix mappings:
--   - wso2/product-integrator:         wso2-integrator-7.1.0.zip                       -> "wso2-integrator-"
--   - wso2/product-integrator-si:      wso2si-4.4.0.zip                                -> "wso2si-"
--   - wso2/integration-control-plane:  wso2-integration-control-plane-2.0.0-beta2.zip  -> "wso2-integration-control-plane-"
--   - ballerina-platform/ballerina-distribution: 
--                                      ballerina-2201.12.7-swan-lake.zip               -> "ballerina-"
--
-- Caveat: The "ballerina-" prefix will also inadvertently match its respective
-- signature and certificate files (e.g., .sig, .crt, .pem). This is the exact 
-- same accepted limitation as "occ_" in migration 000006, since prefix matching 
-- cannot natively exclude by suffix.
-- Idempotent: safe to re-run thanks to ON DUPLICATE KEY UPDATE.
-- ============================================================================

USE `github_statistics`;

INSERT INTO `tracked_repositories` (`org_name`, `repo_name`, `product_name`, `asset_prefixes`)
VALUES
    ('wso2', 'product-integrator', 'Integrator', '["wso2-integrator-"]'),
    ('wso2', 'product-integrator-si', 'Streaming Integrator', '["wso2si-"]'),
    ('wso2', 'integration-control-plane', 'Integration Control Plane', '["wso2-integration-control-plane-"]'),
    ('ballerina-platform', 'ballerina-distribution', 'Ballerina', '["ballerina-"]')
ON DUPLICATE KEY UPDATE
    product_name = VALUES(product_name),
    asset_prefixes = VALUES(asset_prefixes);