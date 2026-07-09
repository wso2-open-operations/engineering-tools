-- asset_prefixes values are verified against each repo's actual GitHub release
-- asset names (checked full release history, not just the latest release —
-- naming conventions have changed over time, e.g. product-apim used wso2apim-
-- during the 3.0.0 milestone series before settling on wso2am-), not guessed.
-- matchesPrefix() in main.bal does an exact startsWith() match with no
-- fallback, so a wrong prefix silently records 0 downloads for that repo
-- forever, with no error anywhere.
-- Idempotent: safe to re-run thanks to ON DUPLICATE KEY UPDATE.
INSERT INTO `tracked_repositories` (`org_name`, `repo_name`, `product_name`, `asset_prefixes`)
VALUES
    ('wso2', 'product-apim-tooling', 'API Manager Tooling', '["apictl-"]'),
    ('wso2', 'integration-demo-scripts', 'Integration Demos', '[]'),
    ('wso2', 'observability-resources', 'Observability', '["wso2-observability-resources-"]'),
    ('wso2', 'product-apim', 'API Manager', '["wso2am-", "wso2apim-"]'),
    ('wso2', 'product-is', 'Identity Server', '["wso2is-"]'),
    ('wso2', 'product-mi-tooling', 'Micro Integrator Tooling', '["mi-", "mi.exe-"]'),
    ('wso2', 'product-microgateway', 'Microgateway', '["wso2am-micro-gw-"]'),
    ('wso2', 'oxygen-ui', 'Oxygen UI', '[]'),
    ('thunder-id', 'thunderid', 'Thunder ID', '["thunderid-"]')
ON DUPLICATE KEY UPDATE
    product_name = VALUES(product_name),
    asset_prefixes = VALUES(asset_prefixes);
