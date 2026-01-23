
export interface Detection {
  uuid: string;
  suser?: string;
  duser?: string;
  attachmentFileName?: string;
  mailMsgSubject?: string;
  eventName?: string;
  eventTime: string;
  severity?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  [key: string]: any;
}

export type SearchEndpoint = 
  | 'search/detections' 
  | 'search/endpointActivities' 
  | 'search/mobileActivities'
  | 'search/networkActivities' 
  | 'search/emailActivities' 
  | 'search/cloudActivities' 
  | 'search/containerActivities';

export interface QueryParams {
  startDateTime: string;
  endDateTime: string;
  top: number;
  mode: string;
  select: string;
}

export interface ApiResponse {
  items: Detection[];
  nextCursor?: string;
}

export interface UserConfig {
  apiKey: string;
  region: 'eu' | 'us' | 'sg' | 'jp' | 'au';
}
