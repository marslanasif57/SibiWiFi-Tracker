
import { MonthlyRecord } from "../types";

/**
 * The Google Client ID is obtained from the environment (process.env.GOOGLE_CLIENT_ID).
 * Fallback to the provided ID if not present.
 */
const GOOGLE_CLIENT_ID = (process.env as any).GOOGLE_CLIENT_ID || '228043020440-edsq0j1r9vj9aadhsomur4mmc7lqnmj0.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const APP_FOLDER_NAME = 'SibiWiFiTracker';

let tokenClient: any = null;
let isInitialized = false;
let userEmailPrefix: string | null = null;
let appFolderId: string | null = null;

/**
 * Helper to wait for a deep global variable to be available.
 */
const waitForPath = (path: string, timeout = 10000): Promise<any> => {
  return new Promise((resolve, reject) => {
    const check = () => {
      const parts = path.split('.');
      let current: any = window;
      for (const part of parts) {
        if (!current[part]) return null;
        current = current[part];
      }
      return current;
    };

    const found = check();
    if (found) return resolve(found);
    
    const start = Date.now();
    const interval = setInterval(() => {
      const found = check();
      if (found) {
        clearInterval(interval);
        resolve(found);
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for Google API: ${path}`));
      }
    }, 100);
  });
};

/**
 * Initialize GAPI and GIS.
 */
export const initDrive = async (): Promise<void> => {
  if (isInitialized && tokenClient) return;

  try {
    const gapi = await waitForPath('gapi');
    await waitForPath('google.accounts.oauth2');

    await new Promise<void>((resolve, reject) => {
      gapi.load('client', {
        callback: async () => {
          try {
            await gapi.client.init({
              discoveryDocs: [DISCOVERY_DOC],
            });
            resolve();
          } catch (err) {
            reject(err);
          }
        },
        onerror: () => reject(new Error('GAPI library failed to load')),
      });
    });

    if (!GOOGLE_CLIENT_ID) {
      throw new Error("Google Client ID is missing.");
    }

    tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: '', 
    });

    isInitialized = true;
    console.debug("Drive Service: Google API initialized.");
  } catch (error) {
    console.error("Drive Service: Initialization Error:", error);
    throw error;
  }
};

/**
 * Fetch the current user's email prefix to identify their unique file.
 */
const fetchUserIdentity = async (accessToken: string): Promise<string> => {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  const data = await response.json();
  if (!data.email) throw new Error("Could not retrieve user email.");
  return data.email.split('@')[0];
};

/**
 * Get or create the dedicated SibiWiFiTracker folder.
 */
const getOrCreateFolderId = async (): Promise<string> => {
  if (appFolderId) return appFolderId;
  const gapi = (window as any).gapi;

  // Search for the folder
  const response = await gapi.client.drive.files.list({
    q: `name = '${APP_FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  const files = response.result.files;
  if (files && files.length > 0) {
    appFolderId = files[0].id;
    return appFolderId!;
  }

  // Create the folder if it doesn't exist
  const createResponse = await gapi.client.drive.files.create({
    resource: {
      name: APP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  appFolderId = createResponse.result.id;
  return appFolderId!;
};

/**
 * Request Access Token and identify user.
 */
export const authenticate = async (): Promise<string> => {
  if (!isInitialized || !tokenClient) {
    await initDrive();
  }

  return new Promise((resolve, reject) => {
    tokenClient.callback = async (resp: any) => {
      if (resp.error !== undefined) {
        reject(resp);
        return;
      }
      try {
        userEmailPrefix = await fetchUserIdentity(resp.access_token);
        resolve(resp.access_token);
      } catch (e) {
        reject(e);
      }
    };

    const gapi = (window as any).gapi;
    const existingToken = gapi.client.getToken();
    tokenClient.requestAccessToken({ prompt: existingToken ? '' : 'consent' });
  });
};

/**
 * Fetch the application data file from the user's dedicated folder.
 */
export const getFileData = async (): Promise<{ id: string; records: MonthlyRecord[] } | null> => {
  const gapi = (window as any).gapi;
  if (!gapi?.client?.drive) throw new Error("Google Drive client is not ready.");
  if (!userEmailPrefix) throw new Error("User identity not established. Please authenticate.");

  const folderId = await getOrCreateFolderId();
  const fileName = `${userEmailPrefix}_bill_record.json`;

  const response = await gapi.client.drive.files.list({
    q: `'${folderId}' in parents and name = '${fileName}' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  const files = response.result.files;
  if (!files || files.length === 0) return null;

  const fileId = files[0].id;
  const contentResponse = await gapi.client.drive.files.get({
    fileId: fileId,
    alt: 'media',
  });

  const records = typeof contentResponse.result === 'string' 
    ? JSON.parse(contentResponse.result) 
    : contentResponse.result;

  return { id: fileId, records };
};

/**
 * Update the data file in Google Drive.
 */
export const updateFile = async (fileId: string, records: MonthlyRecord[]) => {
  const gapi = (window as any).gapi;
  const token = gapi.client.getToken()?.access_token;
  if (!token) throw new Error("Authentication token is missing. Please reconnect.");

  const boundary = '-------314159265358979323846';
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";

  const contentType = 'application/json';
  const metadata = { 'mimeType': contentType };

  const multipartRequestBody =
    delimiter + 'Content-Type: application/json\r\n\r\n' + JSON.stringify(metadata) +
    delimiter + 'Content-Type: ' + contentType + '\r\n\r\n' + JSON.stringify(records) +
    close_delim;

  const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'multipart/related; boundary=' + boundary
    },
    body: multipartRequestBody
  });

  if (!response.ok) throw new Error(`Cloud update failed: ${response.statusText}`);
};

/**
 * Create a new data file inside the SibiWiFiTracker folder.
 */
export const createFile = async (records: MonthlyRecord[]) => {
  const gapi = (window as any).gapi;
  const token = gapi.client.getToken()?.access_token;
  if (!token) throw new Error("Authentication token is missing.");
  if (!userEmailPrefix) throw new Error("User identity not established.");

  const folderId = await getOrCreateFolderId();
  const fileName = `${userEmailPrefix}_bill_record.json`;

  const boundary = '-------314159265358979323846';
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";

  const contentType = 'application/json';
  const metadata = { 
    'name': fileName, 
    'mimeType': contentType,
    'parents': [folderId]
  };

  const multipartRequestBody =
    delimiter + 'Content-Type: application/json\r\n\r\n' + JSON.stringify(metadata) +
    delimiter + 'Content-Type: ' + contentType + '\r\n\r\n' + JSON.stringify(records) +
    close_delim;

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'multipart/related; boundary=' + boundary
    },
    body: multipartRequestBody
  });
  
  const result = await response.json();
  if (!result.id) throw new Error("Failed to create file on Google Drive.");
  return result.id;
};
