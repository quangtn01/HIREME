export interface Campus {
  id: string;
  name: string;
  rooms: string[];
}

export interface Staff {
  id: string;
  staffId: string; // NV001, NV002...
  name: string;
  jobTitleIds: string[];
  departmentIds: string[];
  status: 'Working' | 'Resigned';
  gender?: 'Male' | 'Female' | 'Other';
  birthDate?: string;
  phone?: string;
  email?: string;
  address?: string;
  citizenId?: string;
  citizenIdDate?: string;
  socialInsuranceId?: string;
  healthInsuranceId?: string;
  childrenCount?: number;
  emergencyContact?: string;
  degrees?: string;
  certificates?: string;
  bankAccount?: string;
  bankName?: string;
}

export interface ScheduleItem {
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  campusId: string;
  room: string;
  slot: string;
}

export interface Class {
  id: string;
  name: string;
  programId: string;
  status: 'Active' | 'Archived';
  teacherId: string;
  coTeacherId?: string;
  taId?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  tuitionFull?: number;
  tuitionMonthly?: number;
  schedule: ScheduleItem[];
}

export interface Program {
  id: string;
  name: string;
}

export interface JobTitle {
  id: string;
  name: string;
}

export interface Department {
  id: string;
  name: string;
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
  status?: 'Upcoming' | 'Done';
  attendanceStatus?: 'Not Done' | 'Done';
}

export interface LeaveUsage {
  id: string;
  staffId: string;
  date: string; // YYYY-MM-DD
  days: number;
  reason?: string;
}

export interface Student {
  id: string;
  studentId: string; // HV000001
  name: string;
  nickname?: string;
  status: 'Study' | 'Trial' | 'Pending' | 'Done';
  gender?: 'Male' | 'Female' | 'Other';
  birthYear?: number;
  phone?: string;
  classIds: string[]; // Many classes
  email?: string;
  facebook?: string;
  school?: string;
  parentName?: string;
  parentPhone?: string;
  note?: string;
}

export interface TuitionRecord {
  id: string;
  studentId: string;
  classId: string;
  month: string; // YYYY-MM
  paymentDate: string; // YYYY-MM-DD
  amount: number | 'DONE';
  note?: string;
}

export interface AttendanceRecord {
  id: string;
  classId: string;
  date: string; // YYYY-MM-DD
  students: {
    studentId: string;
    status: 'Present' | 'Absent';
  }[];
}

export interface Permission {
  id: string;
  pageId: string;
  jobTitleIds: string[];
}
