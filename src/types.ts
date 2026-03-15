export interface Campus {
  id: string;
  name: string;
  rooms: string[];
}

export interface Staff {
  id: string;
  name: string;
  role: 'Teacher' | 'TA';
}

export interface Class {
  id: string;
  name: string;
  status: 'Active' | 'Archived';
}

export interface Session {
  id: string;
  classId: string;
  teacherId: string;
  taId?: string;
  campusId: string;
  room: string;
  startTime: string; // ISO
  endTime: string;   // ISO
  zoomId?: string;
  notes?: string;
  weekStart: string; // YYYY-MM-DD
}
