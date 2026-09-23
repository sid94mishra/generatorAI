export function applySceneAppDelegate(source: string): string;
export function sceneDelegateSource(): string;
export function sceneManifest(): {
  UIApplicationSupportsMultipleScenes: boolean;
  UISceneConfigurations: Record<string, Array<{ UISceneConfigurationName: string; UISceneDelegateClassName: string }>>;
};
