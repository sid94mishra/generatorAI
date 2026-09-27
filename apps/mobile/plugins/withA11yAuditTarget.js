// Opt-in XCUITest harness. No test bundle, resources or scheme ships in normal builds.
const fs = require('node:fs');
const path = require('node:path');
const { withXcodeProject, IOSConfig } = require('expo/config-plugins');

const TARGET = 'GeneratorAIUITests';
const unquote = value => String(value ?? '').replace(/^"|"$/g, '');
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function auditScheme(projectName, targetId) {
  const reference = `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${xml(targetId)}" BuildableName="${TARGET}.xctest" BlueprintName="${TARGET}" ReferencedContainer="container:${xml(projectName)}.xcodeproj"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3">
  <BuildAction parallelizeBuildables="NO" buildImplicitDependencies="YES">
    <BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">${reference}</BuildActionEntry></BuildActionEntries>
  </BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.PosixSpawn" shouldUseLaunchSchemeArgsEnv="NO">
    <Testables><TestableReference skipped="NO" parallelizable="NO">${reference}</TestableReference></Testables>
  </TestAction>
  <AnalyzeAction buildConfiguration="Debug"/>
</Scheme>
`;
}

function addAuditTarget(project, projectName, bundleId) {
  const existing = Object.entries(project.pbxNativeTargetSection()).find(([, target]) => unquote(target.name) === TARGET);
  if (existing) return existing[0];
  const host = project.getFirstTarget();
  const priorDependencies = [...host.firstTarget.dependencies];
  // node-xcode has no UI-test shorthand. Create the bundle, then assign Xcode's
  // UI-testing product type. Its default host→test dependency must be removed:
  // normal application builds must never build the opt-in audit runner.
  const target = project.addTarget(TARGET, 'unit_test_bundle', TARGET, `${bundleId}.uitests`);
  const objects = project.hash.project.objects;
  for (const dependency of host.firstTarget.dependencies.filter(item => !priorDependencies.some(prior => prior.value === item.value))) {
    const proxy = objects.PBXTargetDependency?.[dependency.value]?.targetProxy;
    if (proxy) {
      delete objects.PBXContainerItemProxy[proxy];
      delete objects.PBXContainerItemProxy[`${proxy}_comment`];
    }
    delete objects.PBXTargetDependency[dependency.value];
    delete objects.PBXTargetDependency[`${dependency.value}_comment`];
  }
  host.firstTarget.dependencies = priorDependencies;
  target.pbxNativeTarget.productType = '"com.apple.product-type.bundle.ui-testing"';
  // Fresh Expo projects omit empty dependency sections; node-xcode otherwise
  // silently drops addTargetDependency instead of creating them.
  objects.PBXContainerItemProxy ??= {};
  objects.PBXTargetDependency ??= {};
  project.addTargetDependency(target.uuid, [host.uuid]);
  project.addBuildPhase([`${TARGET}/A11yAuditTests.swift`], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
  project.addBuildPhase([`${TARGET}/a11y-routes.json`, `${TARGET}/a11y-allow.json`], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
  project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
  const list = objects.XCConfigurationList[target.pbxNativeTarget.buildConfigurationList];
  for (const item of list.buildConfigurations) {
    const settings = objects.XCBuildConfiguration[item.value].buildSettings;
    delete settings.INFOPLIST_FILE;
    Object.assign(settings, {
      GENERATE_INFOPLIST_FILE: 'YES', SWIFT_VERSION: '5.0', SDKROOT: 'iphoneos',
      IPHONEOS_DEPLOYMENT_TARGET: '17.0', TARGETED_DEVICE_FAMILY: '"1,2"',
      TEST_TARGET_NAME: `"${projectName}"`, CODE_SIGN_STYLE: 'Automatic',
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}.uitests"`,
    });
  }
  const attributes = project.getFirstProject().firstProject.attributes;
  attributes.TargetAttributes ??= {};
  attributes.TargetAttributes[target.uuid] = { CreatedOnToolsVersion: '27.0', TestTargetID: host.uuid };
  return target.uuid;
}

function syncAuditResources(root, nativeRoot) {
  const destination = path.join(nativeRoot, TARGET);
  fs.mkdirSync(destination, { recursive: true });
  for (const file of ['A11yAuditTests.swift', 'a11y-routes.json', 'a11y-allow.json']) {
    fs.copyFileSync(path.join(root, 'e2e', file), path.join(destination, file));
  }
}

function withA11yAuditTarget(config) {
  return withXcodeProject(config, mod => {
    const root = mod.modRequest.projectRoot;
    const nativeRoot = mod.modRequest.platformProjectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(root);
    const targetId = addAuditTarget(mod.modResults, projectName, config.ios.bundleIdentifier);
    syncAuditResources(root, nativeRoot);
    const schemeDir = path.join(nativeRoot, `${projectName}.xcodeproj`, 'xcshareddata', 'xcschemes');
    fs.mkdirSync(schemeDir, { recursive: true });
    fs.writeFileSync(path.join(schemeDir, `${TARGET}.xcscheme`), auditScheme(projectName, targetId));
    return mod;
  });
}

module.exports = withA11yAuditTarget;
module.exports.addAuditTarget = addAuditTarget;
module.exports.auditScheme = auditScheme;
module.exports.syncAuditResources = syncAuditResources;
