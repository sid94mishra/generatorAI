// iOS 27 kills an app that has not adopted the UIScene life cycle before its
// first frame ("Application failed to launch: UIScene life cycle is
// required"). These pin the prebuild transform that adopts it.

import { describe, expect, it } from 'vitest';

import { applySceneAppDelegate, sceneDelegateSource, sceneManifest } from '../../plugins/withSceneLifecycle.js';

// The Expo SDK 57 template's AppDelegate, as prebuild writes it.
const template = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
}
`;

describe('UIScene life cycle adoption', () => {
  it('stops creating the window in the app delegate and keeps the launch options', () => {
    const out = applySceneAppDelegate(template);
    expect(out).not.toContain('UIWindow(frame: UIScreen.main.bounds)');
    expect(out).not.toContain('factory.startReactNative');
    expect(out).toContain('self.launchOptions = launchOptions');
    expect(out).toContain('var launchOptions: [UIApplication.LaunchOptionsKey: Any]?');
    // The factory is still built before the scene asks for it.
    expect(out.indexOf('reactNativeFactory = factory')).toBeLessThan(out.indexOf('self.launchOptions = launchOptions'));
  });

  it('routes the one window scene to SceneDelegate, inside AppDelegate', () => {
    const out = applySceneAppDelegate(template);
    const config = out.indexOf('configurationForConnecting');
    expect(config).toBeGreaterThan(-1);
    expect(config).toBeLessThan(out.indexOf('class ReactNativeDelegate'));
    expect(out).toContain('configuration.delegateClass = SceneDelegate.self');
    // ExpoAppDelegate does not implement it, so `override` fails to compile.
    expect(out).toMatch(/@objc public func application\(\s*_ application: UIApplication,\s*configurationForConnecting/);
    expect(out).not.toMatch(/override func application\(\s*_ application: UIApplication,\s*configurationForConnecting/);
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = applySceneAppDelegate(template);
    expect(applySceneAppDelegate(once)).toBe(once);
  });

  it('fails prebuild loudly if the template changes shape', () => {
    expect(() => applySceneAppDelegate('class AppDelegate {}')).toThrow(/withSceneLifecycle/);
  });

  it('starts React Native in the scene and keeps cold-start links', () => {
    const src = sceneDelegateSource();
    expect(src).toContain('UIWindow(windowScene: windowScene)');
    expect(src).toContain('factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)');
    // A pairing link that launched the app must still reach Linking.getInitialURL().
    expect(src).toContain('launchOptions[.url] = url');
    expect(src).toContain('openURLContexts');
    expect(src).toContain('continue userActivity');
  });

  it('keeps Expo modules informed of foreground and background', () => {
    const src = sceneDelegateSource();
    for (const event of ['applicationDidBecomeActive', 'applicationWillResignActive', 'applicationDidEnterBackground', 'applicationWillEnterForeground']) {
      expect(src).toContain(`ExpoAppDelegateSubscriberManager.${event}`);
    }
  });

  it('declares a single window scene backed by SceneDelegate', () => {
    const manifest = sceneManifest();
    expect(manifest.UIApplicationSupportsMultipleScenes).toBe(false);
    expect(manifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication?.[0]?.UISceneDelegateClassName).toBe(
      '$(PRODUCT_MODULE_NAME).SceneDelegate',
    );
  });
});
