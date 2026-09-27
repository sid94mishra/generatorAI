import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const xcode = createRequire(require.resolve('expo/config-plugins'))('xcode');
const { addAuditTarget, auditScheme } = require('../plugins/withA11yAuditTarget.js');
const APP = '000000000000000000000001';
const PROJECT = '000000000000000000000002';
const GROUP = '000000000000000000000003';
const PRODUCTS = '000000000000000000000004';

// Minimal native graph with the same missing dependency sections as a fresh
// Expo project. It deliberately has no machine-local generated files.
function projectFixture() {
  const project = xcode.project('fixture.pbxproj');
  project.hash = { project: { rootObject: PROJECT, objects: {
    PBXProject: { [PROJECT]: { isa: 'PBXProject', attributes: {}, mainGroup: GROUP,
      productRefGroup: PRODUCTS, targets: [{ value: APP, comment: 'GeneratorAI' }] } },
    PBXNativeTarget: { [APP]: { isa: 'PBXNativeTarget', name: 'GeneratorAI', dependencies: [], buildPhases: [] } },
    PBXGroup: {
      [GROUP]: { isa: 'PBXGroup', children: [{ value: PRODUCTS, comment: 'Products' }], sourceTree: '"<group>"' },
      [PRODUCTS]: { isa: 'PBXGroup', name: 'Products', children: [], sourceTree: '"<group>"' },
    },
    PBXFileReference: {}, PBXBuildFile: {}, XCBuildConfiguration: {}, XCConfigurationList: {},
  } } };
  return project;
}

describe('opt-in accessibility target', () => {
  it('builds the app before the audit without making normal app builds depend on tests', () => {
    const project = projectFixture();
    const id = addAuditTarget(project, 'GeneratorAI', 'dev.generatorai.app');
    const objects = project.hash.project.objects;
    expect(objects.PBXNativeTarget[APP].dependencies).toEqual([]);
    const audit = objects.PBXNativeTarget[id];
    expect(audit.productType).toBe('"com.apple.product-type.bundle.ui-testing"');
    expect(audit.dependencies).toHaveLength(1);
    expect(objects.PBXTargetDependency[audit.dependencies[0].value].target).toBe(APP);
    expect(audit.buildPhases.map(item => item.comment)).toEqual(['Sources', 'Resources', 'Frameworks']);
    const settings = objects.XCConfigurationList[audit.buildConfigurationList].buildConfigurations
      .map(item => objects.XCBuildConfiguration[item.value].buildSettings);
    expect(settings).toHaveLength(2);
    for (const configuration of settings) {
      expect(configuration.GENERATE_INFOPLIST_FILE).toBe('YES');
      expect(configuration.TEST_TARGET_NAME).toBe('"GeneratorAI"');
      expect(configuration.INFOPLIST_FILE).toBeUndefined();
    }
    expect(addAuditTarget(project, 'GeneratorAI', 'dev.generatorai.app')).toBe(id);
    expect(objects.PBXProject[PROJECT].targets).toHaveLength(2);
    expect(auditScheme('GeneratorAI', id)).toContain(`BlueprintIdentifier="${id}"`);
    expect(auditScheme('GeneratorAI', id)).toContain('buildForArchiving="NO"');
  });

  it('preserves existing dependencies and removes node-xcode’s reverse test edge', () => {
    const project = projectFixture();
    const objects = project.hash.project.objects;
    objects.PBXTargetDependency = { EXISTING: { isa: 'PBXTargetDependency', target: 'EXTENSION' } };
    objects.PBXContainerItemProxy = {};
    const dependency = { value: 'EXISTING', comment: 'PBXTargetDependency' };
    objects.PBXNativeTarget[APP].dependencies.push(dependency);
    const id = addAuditTarget(project, 'GeneratorAI', 'dev.generatorai.app');
    expect(objects.PBXNativeTarget[APP].dependencies).toEqual([dependency]);
    expect(Object.values(objects.PBXTargetDependency).filter(item => item?.target === id)).toEqual([]);
    expect(objects.PBXTargetDependency.EXISTING.target).toBe('EXTENSION');
  });
});
