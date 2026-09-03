interface ElectronAPI {
  platform: string;
  openExternal: (url: string) => Promise<void>;
  getAppVersion: () => Promise<string>;
}

interface Window {
  electron?: ElectronAPI;
}
