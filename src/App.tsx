/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs, 
  writeBatch 
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { db, auth } from './firebase';
import * as XLSX from 'xlsx';
import { Campus, Staff, Class, Session, Program, ScheduleItem, JobTitle, Department, LeaveUsage, Student, TuitionRecord, AttendanceRecord, Permission, WaitlistEntry } from './types';
import { StudentView } from './StudentView';
import { 
  LayoutDashboard, 
  Grid,
  Settings, 
  Calendar, 
  Users, 
  Plus, 
  Trash2, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  ChevronUp,
  Copy,
  LogOut,
  UserCircle,
  BookOpen,
  GraduationCap,
  Briefcase,
  Building2,
  Shield,
  Download,
  Upload,
  Check,
  X,
  RefreshCw,
  Edit2,
  Menu,
  Search,
  Clock,
  AlertCircle,
  BarChart3
} from 'lucide-react';
import { 
  BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart as RePieChart, Pie, Cell, LineChart as ReLineChart, Line, AreaChart, Area
} from 'recharts';
import { format, startOfWeek, addDays, parseISO, isSameDay, addWeeks, subWeeks, addMinutes, addMonths, subMonths, startOfMonth, endOfMonth, differenceInDays, isAfter, isBefore, isWithinInterval, startOfDay, endOfDay, subMonths as subMonthsDateFns } from 'date-fns';
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const VIETNAM_TZ = 'Asia/Ho_Chi_Minh';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const safeFormat = (dateStr: any, formatStr: string = 'dd/MM/yyyy', fallback: string = '-') => {
  if (!dateStr) return fallback;
  try {
    const date = typeof dateStr === 'string' ? parseISO(dateStr) : new Date(dateStr);
    if (isNaN(date.getTime())) return fallback;
    // For pure dates (YYYY-MM-DD), we want to avoid timezone shifts
    if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number);
      const utcDate = new Date(Date.UTC(y, m - 1, d));
      return formatInTimeZone(utcDate, 'UTC', formatStr);
    }
    return formatInTimeZone(date, VIETNAM_TZ, formatStr);
  } catch (e) {
    return fallback;
  }
};

const toDisplayDate = (dateStr: string) => {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }
  return dateStr;
};

const fromDisplayDate = (dateStr: string) => {
  if (!dateStr) return '';
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
    const [d, m, y] = dateStr.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return dateStr;
};

export const getValue = (row: any, keys: string[]) => {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
};

export const normalizeImportDate = (val: any) => {
  if (!val) return '';
  
  // If it's a JS Date object
  if (val instanceof Date || (val && typeof val === 'object' && val.constructor.name === 'Date')) {
    const d = val instanceof Date ? val : new Date(val);
    if (isNaN(d.getTime())) return '';
    
    // Use UTC components to get the date exactly as SheetJS intended (usually midnight UTC)
    // This avoids off-by-one errors caused by local timezone shifts
    const y = d.getUTCFullYear();
    const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = d.getUTCDate().toString().padStart(2, '0');
    
    return `${y}-${m}-${day}`;
  }

  // If it's a number (Excel serial date or Year)
  if (typeof val === 'number') {
    // If it's a small number, it's likely just a year (e.g. 2010)
    if (val > 0 && val < 3000) return String(Math.round(val));

    // Excel date starts from 1899-12-30
    // 25569 is the number of days between 1899-12-30 and 1970-01-01
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (isNaN(date.getTime())) return '';
    
    const y = date.getUTCFullYear();
    const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // If it's a string
  if (typeof val === 'string') {
    const str = val.trim();
    if (!str) return '';
    
    // Try yyyy-MM-dd
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      return str.substring(0, 10);
    }
    
    // Try mm/dd/yyyy or dd/mm/yyyy or d/m/yyyy
    const parts = str.split(/[/.-]/);
    if (parts.length === 3) {
      let [p1, p2, p3] = parts;
      if (p1.length === 4) {
        // yyyy-mm-dd
        return `${p1}-${p2.padStart(2, '0')}-${p3.padStart(2, '0')}`;
      } else if (p3.length === 4) {
        // mm/dd/yyyy or dd/mm/yyyy
        const v1 = parseInt(p1);
        const v2 = parseInt(p2);
        
        if (v1 > 12) {
          // dd/mm/yyyy
          return `${p3}-${p2.padStart(2, '0')}-${p1.padStart(2, '0')}`;
        } else if (v2 > 12) {
          // mm/dd/yyyy
          return `${p3}-${p1.padStart(2, '0')}-${p2.padStart(2, '0')}`;
        } else {
          // Ambiguous, default to dd/mm/yyyy for VN context
          return `${p3}-${p2.padStart(2, '0')}-${p1.padStart(2, '0')}`;
        }
      }
    }
  }

  return String(val);
};

const normalizeImportTime = (val: any) => {
  if (!val) return '00:00';
  
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '00:00';
    // Use UTC components to avoid timezone shifts
    const h = val.getUTCHours().toString().padStart(2, '0');
    const m = val.getUTCMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
  
  if (typeof val === 'number') {
    // Excel time is fraction of a day
    // We can use a Date object to extract time components in UTC (which is how Excel stores time)
    const date = new Date(Math.round(val * 86400 * 1000));
    const h = date.getUTCHours().toString().padStart(2, '0');
    const m = date.getUTCMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
  
  if (typeof val === 'string') {
    const str = val.trim();
    if (!str) return '00:00';
    if (str.includes(':')) {
      const parts = str.split(':');
      const h = parts[0].padStart(2, '0');
      const m = (parts[1] || '00').padStart(2, '0');
      return `${h}:${m}`;
    }
  }
  
  return '00:00';
};

const formatExcelDate = (dateStr: any) => {
  if (!dateStr) return '';
  try {
    const str = String(dateStr);
    // For pure dates (YYYY-MM-DD), we want to avoid timezone shifts
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const [y, m, d] = str.split('-').map(Number);
      const utcDate = new Date(Date.UTC(y, m - 1, d));
      return formatInTimeZone(utcDate, 'UTC', 'dd/MM/yyyy');
    }
    const date = parseISO(str);
    if (isNaN(date.getTime())) return String(dateStr);
    return formatInTimeZone(date, VIETNAM_TZ, 'dd/MM/yyyy');
  } catch (e) {
    return String(dateStr);
  }
};

const parseExcelDate = (dateStr: any, timeStr: any) => {
  try {
    if (!dateStr) return null;
    const normalizedDate = normalizeImportDate(dateStr);
    if (!normalizedDate) return null;
    
    const normalizedTime = normalizeImportTime(timeStr);
    // Interpret the combined date/time as being in Vietnam timezone
    const zonedDate = fromZonedTime(`${normalizedDate} ${normalizedTime}`, VIETNAM_TZ);
    return zonedDate.toISOString();
  } catch (e) {
    return null;
  }
};

// --- Components ---

const Button = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button className={cn("px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50", className)} {...props} />
);

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn("w-full px-4 py-2 bg-white border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20", className)} {...props} />
);

const Select = ({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn("w-full px-4 py-2 bg-white border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20", className)} {...props} />
);

const SessionTimePicker = ({ startTime, endTime, onChange }: { startTime: string | undefined, endTime: string | undefined, onChange: (start: string, end: string) => void }) => {
  const start = startTime ? parseISO(startTime) : new Date();
  const end = endTime ? parseISO(endTime) : new Date();
  
  const dateStr = format(start, 'yyyy-MM-dd');
  const startHour = format(start, 'HH');
  const startMinute = ['00', '15', '30', '45'].includes(format(start, 'mm')) ? format(start, 'mm') : '00';
  
  const endHour = format(end, 'HH');
  const endMinute = ['00', '15', '30', '45'].includes(format(end, 'mm')) ? format(end, 'mm') : '00';

  const update = (newDate: string, sH: string, sM: string, eH: string, eM: string) => {
    const s = new Date(`${newDate}T${sH}:${sM}:00`);
    const e = new Date(`${newDate}T${eH}:${eM}:00`);
    onChange(s.toISOString(), e.toISOString());
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Date</label>
        <Input 
          placeholder="dd/mm/yyyy"
          value={toDisplayDate(dateStr)} 
          onChange={e => update(fromDisplayDate(e.target.value), startHour, startMinute, endHour, endMinute)} 
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Start Time</label>
          <div className="flex gap-2">
            <Select value={startHour} onChange={e => update(dateStr, e.target.value, startMinute, endHour, endMinute)}>
              {Array.from({length: 24}, (_, i) => i.toString().padStart(2, '0')).map(h => <option key={h} value={h}>{h}</option>)}
            </Select>
            <Select value={startMinute} onChange={e => update(dateStr, startHour, e.target.value, endHour, endMinute)}>
              {['00', '15', '30', '45'].map(m => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">End Time</label>
          <div className="flex gap-2">
            <Select value={endHour} onChange={e => update(dateStr, startHour, startMinute, e.target.value, endMinute)}>
              {Array.from({length: 24}, (_, i) => i.toString().padStart(2, '0')).map(h => <option key={h} value={h}>{h}</option>)}
            </Select>
            <Select value={endMinute} onChange={e => update(dateStr, startHour, startMinute, endHour, e.target.value)}>
              {['00', '15', '30', '45'].map(m => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

const NAV_STRUCTURE = [
  {
    category: 'Timetable',
    icon: <Calendar size={18} />,
    isOpenKey: 'isTimetableOpen',
    pages: [
      { id: 'timetable-teacher', label: 'Teacher View', icon: <Users size={16} /> },
      { id: 'staff', label: 'Staff View', icon: <Users size={16} /> },
      { id: 'dashboard2', label: 'Office View', icon: <Grid size={16} /> },
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
    ]
  },
  {
    category: 'Course',
    icon: <BookOpen size={18} />,
    isOpenKey: 'isCourseOpen',
    pages: [
      { id: 'course-summary', label: 'Summary', icon: <Grid size={16} /> },
      { id: 'course-dashboard', label: 'Dashboard', icon: <LayoutDashboard size={16} /> },
      { id: 'course-byClass', label: 'By Class', icon: <BookOpen size={16} /> },
      { id: 'course-details', label: 'Course Details', icon: <BookOpen size={16} /> },
      { id: 'course-tuition', label: 'Tuition Class', icon: <Briefcase size={16} /> },
      { id: 'course-attendance', label: 'Attendance', icon: <Check size={16} /> },
    ]
  },
  {
    category: 'Student',
    icon: <GraduationCap size={18} />,
    isOpenKey: 'isStudentOpen',
    pages: [
      { id: 'student-details', label: 'Details', icon: <Users size={16} /> },
      { id: 'student-summary', label: 'Summary', icon: <Grid size={16} /> },
    ]
  },
  {
    category: 'Teacher',
    icon: <Users size={18} />,
    isOpenKey: 'isTeacherOpen',
    pages: [
      { id: 'teacher-summary', label: 'Summary', icon: <Grid size={16} /> },
      { id: 'teacher-details', label: 'Details', icon: <Users size={16} /> },
      { id: 'teacher-leave', label: 'Leave Tracker', icon: <Calendar size={16} /> },
      { id: 'teacher-timesheet', label: 'Timesheet', icon: <Clock size={16} /> },
    ]
  },
  {
    category: 'Officer',
    icon: <Briefcase size={18} />,
    isOpenKey: 'isOfficerOpen',
    pages: [
      { id: 'officer-waitlist', label: 'Waitlist', icon: <Users size={16} /> },
    ]
  },
  {
    category: 'Report',
    icon: <BarChart3 size={18} />,
    isOpenKey: 'isReportOpen',
    pages: [
      { id: 'report-overview', label: 'Overview', icon: <Grid size={16} /> },
      { id: 'report-students', label: 'Students', icon: <Users size={16} /> },
      { id: 'report-revenue', label: 'Revenue', icon: <Briefcase size={16} /> },
    ]
  },
  {
    category: 'Management',
    id: 'management',
    icon: <Settings size={18} />,
    pages: [] // No sub-pages
  }
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('timetable-teacher');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isTimetableOpen, setIsTimetableOpen] = useState(true);
  const [isCourseOpen, setIsCourseOpen] = useState(false);
  const [isStudentOpen, setIsStudentOpen] = useState(false);
  const [isTeacherOpen, setIsTeacherOpen] = useState(false);
  const [isOfficerOpen, setIsOfficerOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [leaveUsage, setLeaveUsage] = useState<LeaveUsage[]>([]);
  const [tuitionRecords, setTuitionRecords] = useState<TuitionRecord[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Partial<Session> | null>(null);

  useEffect(() => {
    if (activeTab.startsWith('course')) setIsCourseOpen(true);
    if (activeTab.startsWith('student')) setIsStudentOpen(true);
    if (activeTab.startsWith('teacher')) setIsTeacherOpen(true);
    if (activeTab.startsWith('officer')) setIsOfficerOpen(true);
    if (activeTab.startsWith('report')) setIsReportOpen(true);
    if (['staff', 'dashboard2', 'dashboard'].includes(activeTab)) setIsTimetableOpen(true);
  }, [activeTab]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Check if user is in staff collection with status 'Working'
        const staffRef = collection(db, 'staff');
        const q = query(staffRef, where('email', '==', u.email), where('status', '==', 'Working'));
        const snap = await getDocs(q);
        
        const isAdminBypass = u.email === 'quangtn01@gmail.com';
        
        if (snap.empty && !isAdminBypass) {
          setAuthError("Unauthorized: Only active staff members can access this system.");
          await auth.signOut();
          setUser(null);
        } else {
          setAuthError(null);
          setUser(u);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Monitor staff status changes for the current user
  useEffect(() => {
    if (!user || staff.length === 0) return;
    
    const currentStaff = staff.find(s => s.email === user.email);
    if (currentStaff && currentStaff.status !== 'Working') {
      auth.signOut();
      setAuthError("Your account status has been updated. Access revoked.");
    }
  }, [staff, user]);

  useEffect(() => {
    if (!user) return;

    const unsubCampuses = onSnapshot(collection(db, 'campuses'), (snap) => {
      setCampuses(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, rooms: data.rooms || [] } as Campus;
      }));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'campuses'));
    const unsubStaff = onSnapshot(collection(db, 'staff'), (snap) => {
      setStaff(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, jobTitleIds: data.jobTitleIds || [], departmentIds: data.departmentIds || [] } as Staff;
      }));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'staff'));
    const unsubClasses = onSnapshot(collection(db, 'classes'), (snap) => {
      setClasses(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, schedule: data.schedule || [] } as Class;
      }));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'classes'));
    const unsubStudents = onSnapshot(collection(db, 'students'), (snap) => {
      setStudents(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, classIds: data.classIds || [] } as Student;
      }));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'students'));
    const unsubPrograms = onSnapshot(collection(db, 'programs'), (snap) => {
      setPrograms(snap.docs.map(d => ({ id: d.id, ...d.data() } as Program)));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'programs'));
    const unsubJobTitles = onSnapshot(collection(db, 'jobTitles'), (snap) => {
      setJobTitles(snap.docs.map(d => ({ id: d.id, ...d.data() } as JobTitle)));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'jobTitles'));
    const unsubDepartments = onSnapshot(collection(db, 'departments'), (snap) => {
      setDepartments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Department)));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'departments'));
    const unsubSessions = onSnapshot(collection(db, 'sessions'), (snap) => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Session)));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'sessions'));
    const unsubLeave = onSnapshot(collection(db, 'leaveUsage'), (snap) => {
      setLeaveUsage(snap.docs.map(d => ({ id: d.id, ...d.data() } as LeaveUsage)));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'leaveUsage'));
    const unsubTuition = onSnapshot(collection(db, 'tuitionRecords'), (snap) => {
      setTuitionRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as TuitionRecord)));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'tuitionRecords'));
    const unsubAttendance = onSnapshot(collection(db, 'attendanceRecords'), (snap) => {
      setAttendanceRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord)));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'attendanceRecords'));
    const unsubWaitlist = onSnapshot(collection(db, 'waitlist'), (snap) => {
      setWaitlist(snap.docs.map(d => ({ id: d.id, ...d.data() } as WaitlistEntry)));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'waitlist'));
    const unsubPermissions = onSnapshot(collection(db, 'permissions'), (snap) => {
      setPermissions(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, jobTitleIds: data.jobTitleIds || [] } as Permission;
      }));
    }, (err) => handleFirestoreError(err, OperationType.GET, 'permissions'));

    return () => {
      unsubCampuses();
      unsubStaff();
      unsubClasses();
      unsubStudents();
      unsubPrograms();
      unsubJobTitles();
      unsubDepartments();
      unsubSessions();
      unsubLeave();
      unsubTuition();
      unsubAttendance();
      unsubWaitlist();
      unsubPermissions();
    };
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const handleLogout = () => auth.signOut();

  if (loading) return <div className="h-screen flex items-center justify-center font-mono text-sm opacity-50">LOADING...</div>;

  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#f5f5f0] p-6">
        <div className="max-w-md w-full bg-white p-12 rounded-[32px] shadow-sm border border-black/5 text-center">
          <h1 className="text-4xl font-serif italic mb-2">Hireme Center</h1>
          <p className="text-black/50 mb-8">Schedule Management System</p>
          
          {authError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium">
              {authError}
            </div>
          )}

          <Button onClick={handleLogin} className="w-full bg-emerald-600 text-white hover:bg-emerald-700 py-4 flex items-center justify-center gap-2">
            <UserCircle size={20} />
            Sign in with Google
          </Button>
        </div>
      </div>
    );
  }

  const currentUserStaff = staff.find(s => s.email === user.email);
  const currentUserJobTitleIds = currentUserStaff?.jobTitleIds || [];

  const hasPermission = (pageId: string) => {
    if (user.email === 'quangtn01@gmail.com') return true;
    const perm = permissions.find(p => p.pageId === pageId);
    if (!perm) return false;
    return perm.jobTitleIds?.some(id => currentUserJobTitleIds?.includes(id));
  };

  return (
    <div className="h-screen bg-[#f5f5f0] flex relative overflow-hidden">
      {/* Sidebar Toggle Button (Floating) */}
      <button 
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className={cn(
          "fixed top-6 z-[60] p-2 bg-white rounded-xl border border-black/5 shadow-sm hover:bg-black/5 transition-all",
          isSidebarOpen ? "left-[272px]" : "left-6"
        )}
        title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
      >
        <Menu size={20} className="text-black/60" />
      </button>

      {/* Sidebar */}
      <aside className={cn(
        "bg-white border-r border-black/5 flex flex-col transition-all duration-300 overflow-y-auto",
        isSidebarOpen ? "w-64" : "w-0 border-none"
      )}>
        <div className="p-6 border-bottom border-black/5 whitespace-nowrap">
          <h2 className="text-xl font-serif italic">Hireme Center</h2>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          {NAV_STRUCTURE.map(cat => {
            const visiblePages = cat.pages.filter(p => hasPermission(p.id));
            const isCategoryVisible = cat.id ? hasPermission(cat.id) : visiblePages.length > 0;

            if (!isCategoryVisible) return null;

            if (cat.id) {
              // Top-level item like Management
              return (
                <NavItem 
                  key={cat.id}
                  icon={cat.icon} 
                  label={cat.category} 
                  active={activeTab === cat.id} 
                  onClick={() => setActiveTab(cat.id)} 
                />
              );
            }

            const isOpen = cat.isOpenKey === 'isTimetableOpen' ? isTimetableOpen :
                           cat.isOpenKey === 'isCourseOpen' ? isCourseOpen :
                           cat.isOpenKey === 'isStudentOpen' ? isStudentOpen :
                           cat.isOpenKey === 'isTeacherOpen' ? isTeacherOpen :
                           cat.isOpenKey === 'isOfficerOpen' ? isOfficerOpen :
                           cat.isOpenKey === 'isReportOpen' ? isReportOpen : false;
            
            const setIsOpen = cat.isOpenKey === 'isTimetableOpen' ? setIsTimetableOpen :
                              cat.isOpenKey === 'isCourseOpen' ? setIsCourseOpen :
                              cat.isOpenKey === 'isStudentOpen' ? setIsStudentOpen :
                              cat.isOpenKey === 'isTeacherOpen' ? setIsTeacherOpen :
                              cat.isOpenKey === 'isOfficerOpen' ? setIsOfficerOpen :
                              cat.isOpenKey === 'isReportOpen' ? setIsReportOpen : () => {};

            return (
              <div key={cat.category}>
                <button 
                  onClick={() => setIsOpen(!isOpen)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold text-black/40 hover:bg-black/5 transition-all uppercase tracking-wider"
                >
                  <div className="flex items-center gap-3">
                    {cat.icon}
                    {cat.category}
                  </div>
                  {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                
                {isOpen && (
                  <div className="mt-1 ml-4 space-y-1 border-l-2 border-black/5 pl-2">
                    {visiblePages.map(page => (
                      <NavItem 
                        key={page.id}
                        icon={page.icon} 
                        label={page.label} 
                        active={activeTab === page.id} 
                        onClick={() => setActiveTab(page.id)} 
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="p-4 border-t border-black/5">
          <div className="flex items-center gap-3 mb-4 px-2">
            <img src={user.photoURL || ''} className="w-8 h-8 rounded-full border border-black/10" alt="" referrerPolicy="no-referrer" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold truncate">{user.displayName}</p>
              <p className="text-[10px] text-black/40 truncate">{user.email}</p>
            </div>
          </div>
          <Button onClick={handleLogout} className="w-full text-red-500 hover:bg-red-50 py-2 flex items-center justify-center gap-2 text-sm">
            <LogOut size={16} />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-4 pb-2">
        {!hasPermission(activeTab) ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
            <div className="p-6 bg-red-50 rounded-[32px] border border-red-100">
              <Shield size={48} className="text-red-500 mx-auto mb-4" />
              <h2 className="text-2xl font-serif italic text-red-900">Access Denied</h2>
              <p className="text-red-600/60 max-w-md">
                You do not have permission to access this page. Please contact your administrator if you believe this is an error.
              </p>
            </div>
            <Button 
              onClick={() => setActiveTab('dashboard')}
              className="bg-black/5 hover:bg-black/10 text-black/60"
            >
              Back to Dashboard
            </Button>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
          <DashboardView 
            campuses={campuses} 
            sessions={sessions} 
            staff={staff} 
            classes={classes} 
            onAddSession={(data) => {
              setEditingSession(data);
              setIsModalOpen(true);
            }}
          />
        )}
        {activeTab === 'timetable-teacher' && (
          <TimetableTeacherView 
            staff={staff} 
            sessions={sessions} 
            classes={classes} 
            campuses={campuses} 
            userEmail={user.email}
            students={students}
            attendanceRecords={attendanceRecords}
          />
        )}
        {activeTab === 'dashboard2' && (
          <Dashboard2View 
            campuses={campuses} 
            sessions={sessions} 
            staff={staff} 
            classes={classes} 
            onAddSession={(data) => {
              setEditingSession(data);
              setIsModalOpen(true);
            }}
          />
        )}
        {activeTab === 'staff' && (
          <StaffView 
            staff={staff} 
            sessions={sessions} 
            classes={classes} 
            campuses={campuses} 
            jobTitles={jobTitles}
          />
        )}
        {activeTab.startsWith('course') && (
          <CourseView 
            subTab={activeTab === 'course' ? 'dashboard' : activeTab.split('-')[1] as any}
            classes={classes} programs={programs} staff={staff} campuses={campuses} jobTitles={jobTitles} 
            students={students} tuitionRecords={tuitionRecords} attendanceRecords={attendanceRecords}
            sessions={sessions}
          />
        )}
        {activeTab.startsWith('student') && (
          <StudentView 
            subTab={activeTab === 'student' ? 'details' : activeTab.split('-')[1] as any}
            students={students}
            classes={classes}
          />
        )}
        {activeTab.startsWith('teacher') && (
          <TeacherView 
            subTab={activeTab === 'teacher' ? 'summary' : activeTab.split('-')[1] as any}
            staff={staff} 
            jobTitles={jobTitles} 
            departments={departments} 
            classes={classes} 
            sessions={sessions} 
            leaveUsage={leaveUsage}
          />
        )}
        {activeTab.startsWith('officer') && (
          <OfficerView 
            subTab={activeTab === 'officer' ? 'waitlist' : activeTab.split('-')[1] as any}
            waitlist={waitlist}
            staff={staff}
            classes={classes}
            jobTitles={jobTitles}
            students={students}
          />
        )}
        {activeTab.startsWith('report') && (
          <ReportView 
            subTab={activeTab === 'report' ? 'overview' : activeTab.split('-')[1] as any}
            students={students}
            classes={classes}
            tuitionRecords={tuitionRecords}
            attendanceRecords={attendanceRecords}
            staff={staff}
            departments={departments}
          />
        )}
        {activeTab === 'management' && (
          <ManagementView 
            campuses={campuses} 
            programs={programs} 
            jobTitles={jobTitles}
            departments={departments}
            permissions={permissions}
            navStructure={NAV_STRUCTURE}
          />
        )}
          </>
        )}
      </main>

      {isModalOpen && (
        <SessionModal 
          isOpen={isModalOpen}
          onClose={() => { setIsModalOpen(false); setEditingSession(null); }}
          editingSession={editingSession}
          setEditingSession={setEditingSession}
          campuses={campuses}
          staff={staff}
          classes={classes}
          jobTitles={jobTitles}
        />
      )}
    </div>
  );
}

function SessionModal({ isOpen, onClose, editingSession, setEditingSession, campuses, staff, classes, jobTitles }: { 
  isOpen: boolean, 
  onClose: () => void, 
  editingSession: Partial<Session> | null, 
  setEditingSession: (s: Partial<Session> | null) => void,
  campuses: Campus[],
  staff: Staff[],
  classes: Class[],
  jobTitles: JobTitle[]
}) {
  const [confirmDone, setConfirmDone] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const activeClasses = classes
    .filter(c => c.status === 'Active')
    .sort((a, b) => a.name.localeCompare(b.name));

  const sortedCampuses = [...campuses].sort((a, b) => a.name.localeCompare(b.name));
  const sortedTeachers = staff
    .filter(s => s.jobTitleIds?.includes(jobTitles.find(jt => jt.name === 'Teacher')?.id || ''))
    .sort((a, b) => a.staffId.localeCompare(b.staffId));
  const sortedTAs = staff
    .filter(s => s.jobTitleIds?.includes(jobTitles.find(jt => jt.name === 'TA')?.id || ''))
    .sort((a, b) => a.staffId.localeCompare(b.staffId));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSession || !editingSession.startTime) return;

    const weekStart = format(startOfWeek(parseISO(editingSession.startTime), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const data = {
      ...editingSession,
      weekStart,
      status: editingSession.status || 'Upcoming',
      attendanceStatus: editingSession.attendanceStatus || 'Not Done'
    } as any;

    try {
      if (editingSession.id) {
        await updateDoc(doc(db, 'sessions', editingSession.id), data);
      } else {
        await addDoc(collection(db, 'sessions'), data);
      }
      onClose();
    } catch (err) {
      handleFirestoreError(err, editingSession.id ? OperationType.UPDATE : OperationType.CREATE, 'sessions');
    }
  };

  const handleMarkDone = async () => {
    if (!editingSession?.id || editingSession.status === 'Done') return;
    if (!confirmDone) {
      setConfirmDone(true);
      return;
    }
    try {
      await updateDoc(doc(db, 'sessions', editingSession.id), {
        status: 'Done'
      });
      setEditingSession({ ...editingSession, status: 'Done' });
      setConfirmDone(false);
      onClose();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'sessions');
    }
  };

  const handleDelete = async () => {
    if (!editingSession?.id) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteDoc(doc(db, 'sessions', editingSession.id));
      onClose();
      setConfirmDelete(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'sessions');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <div className="bg-white w-full max-w-lg rounded-[32px] p-8 shadow-2xl border border-black/5">
        <h2 className="text-2xl font-serif italic mb-6">{editingSession?.id ? 'Edit Session' : 'New Session'}</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Class</label>
              <Select required value={editingSession?.classId || ''} onChange={e => setEditingSession({...editingSession, classId: e.target.value})}>
                <option value="">Select Class</option>
                {activeClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Campus</label>
              <Select required value={editingSession?.campusId || ''} onChange={e => setEditingSession({...editingSession, campusId: e.target.value, room: ''})}>
                <option value="">Select Campus</option>
                {sortedCampuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Room</label>
              <Select required value={editingSession?.room || ''} onChange={e => setEditingSession({...editingSession, room: e.target.value})}>
                <option value="">Select Room</option>
                {campuses.find(c => c.id === editingSession?.campusId)?.rooms.map(r => <option key={r} value={r}>{r}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Zoom ID</label>
              <Input placeholder="Zoom ID" value={editingSession?.zoomId || ''} onChange={e => setEditingSession({...editingSession, zoomId: e.target.value})} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Teacher</label>
              <Select required value={editingSession?.teacherId || ''} onChange={e => setEditingSession({...editingSession, teacherId: e.target.value})}>
                <option value="">Select Teacher</option>
                {sortedTeachers.map(s => <option key={s.staffId} value={s.staffId}>{s.staffId} - {s.name}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-black/40 ml-1">TA (Optional)</label>
              <Select value={editingSession?.taId || ''} onChange={e => setEditingSession({...editingSession, taId: e.target.value})}>
                <option value="">Select TA</option>
                {sortedTAs.map(s => <option key={s.staffId} value={s.staffId}>{s.staffId} - {s.name}</option>)}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <SessionTimePicker 
              startTime={editingSession?.startTime} 
              endTime={editingSession?.endTime} 
              onChange={(start, end) => setEditingSession({...editingSession, startTime: start, endTime: end})} 
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Notes (Optional)</label>
            <textarea 
              placeholder="Add any additional notes here..." 
              className="w-full bg-black/5 border border-black/5 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 min-h-[80px] resize-none"
              value={editingSession?.notes || ''} 
              onChange={e => setEditingSession({...editingSession, notes: e.target.value})} 
            />
          </div>

          <div className="space-y-3 pt-4">
            <div className="flex gap-3">
              <Button type="button" onClick={onClose} className="flex-1 bg-black/5 hover:bg-black/10">Cancel</Button>
              <Button type="submit" className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700">Save Session</Button>
            </div>
            {editingSession?.id && (
              <div className="flex gap-3">
                <button 
                  type="button" 
                  disabled={editingSession.status === 'Done'}
                  onClick={handleMarkDone}
                  onMouseLeave={() => setConfirmDone(false)}
                  className={cn(
                    "flex-1 py-2 text-xs rounded-xl transition-all flex items-center justify-center gap-2 border",
                    editingSession.status === 'Done'
                      ? "bg-emerald-100 text-emerald-700 border-emerald-200 cursor-not-allowed font-bold"
                      : confirmDone 
                        ? "bg-red-600 text-white border-red-600 font-bold animate-pulse" 
                        : "bg-black/5 text-black/60 hover:bg-black/10 border-transparent"
                  )}
                >
                  {editingSession.status === 'Done' ? (
                    <><Check size={14} /> Done</>
                  ) : (
                    <>{confirmDone ? 'Xác nhận đã diễn ra' : 'Upcoming'}</>
                  )}
                </button>

                <button 
                  type="button" 
                  onClick={handleDelete}
                  onMouseLeave={() => setConfirmDelete(false)}
                  className={cn(
                    "flex-1 py-2 text-xs rounded-xl transition-all flex items-center justify-center gap-2 border",
                    confirmDelete 
                      ? "bg-red-600 text-white border-red-600 font-bold animate-pulse" 
                      : "text-red-400 hover:text-red-600 hover:bg-red-50 border-transparent"
                  )}
                >
                  <Trash2 size={14} />
                  {confirmDelete ? 'Xác nhận xóa' : 'Delete Session'}
                </button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, key?: any }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
        active ? "bg-emerald-50 text-emerald-700" : "text-black/60 hover:bg-black/5"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// --- View: Dashboard (Campus Grid) ---

const SLOTS = [
  { id: '14:00', label: '14:00 - 15:30', start: '14:00' },
  { id: '15:30', label: '15:30 - 17:00', start: '15:30' },
  { id: '17:45', label: '17:45 - 19:15', start: '17:45' },
  { id: '19:30', label: '19:30 - 21:00', start: '19:30' },
];

function DashboardView({ campuses, sessions, staff, classes, onAddSession }: { 
  campuses: Campus[], 
  sessions: Session[], 
  staff: Staff[], 
  classes: Class[],
  onAddSession: (data: Partial<Session>) => void
}) {
  const [selectedCampusId, setSelectedCampusId] = useState<string>('');
  const [currentWeek, setCurrentWeek] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [copyStatus, setCopyStatus] = useState<{
    show: boolean;
    message: string;
    onConfirm?: () => void;
    isLoading?: boolean;
    isSuccess?: boolean;
  }>({ show: false, message: '' });

  useEffect(() => {
    if (!selectedCampusId && campuses.length > 0) {
      setSelectedCampusId(campuses[0].id);
    }
  }, [campuses, selectedCampusId]);

  const campus = campuses.find(c => c.id === selectedCampusId);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i));

  const copyPreviousWeek = async () => {
    const prevWeekStart = subWeeks(currentWeek, 1);
    const prevWeekEnd = addDays(prevWeekStart, 6);
    const weekStartStr = format(currentWeek, 'yyyy-MM-dd');

    const startTs = startOfDay(prevWeekStart).getTime();
    const endTs = endOfDay(prevWeekEnd).getTime();

    // Filter ALL sessions from the previous week across all campuses
    const prevSessions = sessions.filter(s => {
      try {
        const sessionDate = parseISO(s.startTime);
        const ts = sessionDate.getTime();
        return ts >= startTs && ts <= endTs;
      } catch (e) {
        return false;
      }
    });
    
    if (!prevSessions.length) {
      setCopyStatus({
        show: true,
        message: `Không tìm thấy buổi dạy nào trong tuần trước (${format(prevWeekStart, 'dd/MM/yyyy')} - ${format(prevWeekEnd, 'dd/MM/yyyy')}).`,
      });
      return;
    }

    setCopyStatus({
      show: true,
      message: `Tìm thấy ${prevSessions.length} buổi dạy trong tuần trước. Bạn có muốn copy toàn bộ sang tuần này (${format(currentWeek, 'dd/MM/yyyy')}) không?`,
      onConfirm: async () => {
        setCopyStatus(prev => ({ ...prev, isLoading: true, message: 'Đang copy lịch dạy...' }));
        try {
          const CHUNK_SIZE = 450;
          for (let i = 0; i < prevSessions.length; i += CHUNK_SIZE) {
            const chunk = prevSessions.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);
            
            chunk.forEach(s => {
              const { id, ...rest } = s;
              const newStartTime = addWeeks(parseISO(s.startTime), 1).toISOString();
              const newEndTime = addWeeks(parseISO(s.endTime), 1).toISOString();
              
              const newSessionRef = doc(collection(db, 'sessions'));
              batch.set(newSessionRef, {
                ...rest,
                startTime: newStartTime,
                endTime: newEndTime,
                weekStart: weekStartStr,
                status: 'Upcoming'
              });
            });
            
            await batch.commit();
          }
          setCopyStatus({
            show: true,
            message: `Đã copy thành công ${prevSessions.length} buổi dạy sang tuần này!`,
            isSuccess: true
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'sessions');
          setCopyStatus({
            show: true,
            message: "Có lỗi xảy ra khi copy lịch dạy. Vui lòng thử lại.",
          });
        }
      }
    });
  };

  const handleDoubleClick = (day: Date, slot: typeof SLOTS[0], room: string) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const startTime = new Date(`${dateStr}T${slot.start}:00`).toISOString();
    
    // Calculate end time (90 mins later)
    const end = addMinutes(parseISO(startTime), 90);
    const endTime = end.toISOString();

    onAddSession({
      campusId: selectedCampusId,
      room,
      startTime,
      endTime
    });
  };

  const exportToExcel = () => {
    const weekSessions = sessions.filter(s => 
      s.campusId === selectedCampusId && 
      isWithinInterval(parseISO(s.startTime), {
        start: currentWeek,
        end: addDays(currentWeek, 6)
      })
    ).sort((a, b) => a.startTime.localeCompare(b.startTime));

    const dataToExport = weekSessions.map(s => {
      const cls = classes.find(c => c.id === s.classId);
      const teacher = staff.find(st => st.staffId === s.teacherId);
      const ta = staff.find(st => st.staffId === s.taId);
      const campus = campuses.find(c => c.id === s.campusId);

      return {
        'ID (System)': s.id,
        'Date': formatExcelDate(s.startTime),
        'Start Time': safeFormat(s.startTime, 'HH:mm'),
        'End Time': safeFormat(s.endTime, 'HH:mm'),
        'Campus': campus?.name || '',
        'Room': s.room || '',
        'Class': cls?.name || '',
        'Teacher ID': s.teacherId || '',
        'Teacher Name': teacher?.name || '',
        'TA ID': s.taId || '',
        'TA Name': ta?.name || '',
        'Zoom ID': s.zoomId || '',
        'Notes': s.notes || ''
      };
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Timetable");
    XLSX.writeFile(wb, `Timetable_${campus?.name || 'Campus'}_${format(currentWeek, 'yyyy-MM-dd')}.xlsx`);
  };

  const importFromExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const data = evt.target?.result;
      const wb = XLSX.read(data, { type: 'array' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const jsonData = XLSX.utils.sheet_to_json(ws) as any[];

      try {
        const batch = writeBatch(db);
        
        for (const row of jsonData) {
          let startTime = '';
          let endTime = '';
          const dateVal = getValue(row, ['Date', 'Ngày']);
          const startVal = getValue(row, ['Start Time', 'Giờ bắt đầu']);
          const endVal = getValue(row, ['End Time', 'Giờ kết thúc']);

          if (dateVal && startVal && endVal) {
            const parsedStart = parseExcelDate(dateVal, startVal);
            const parsedEnd = parseExcelDate(dateVal, endVal);
            if (parsedStart && parsedEnd) {
              startTime = parsedStart;
              endTime = parsedEnd;
            }
          }

          if (!startTime) continue;

          const weekStart = format(startOfWeek(parseISO(startTime), { weekStartsOn: 1 }), 'yyyy-MM-dd');

          const sessionData: any = {
            campusId: selectedCampusId,
            room: getValue(row, ['Room', 'Phòng']) || '',
            classId: classes.find(c => c.name === getValue(row, ['Class', 'Lớp']))?.id || '',
            teacherId: getValue(row, ['Teacher ID', 'Mã GV']) || '',
            taId: getValue(row, ['TA ID', 'Mã TA']) || '',
            zoomId: getValue(row, ['Zoom ID', 'ID Zoom']) || '',
            notes: getValue(row, ['Notes', 'Ghi chú']) || '',
            startTime,
            endTime,
            weekStart,
            status: 'Upcoming'
          };

          const systemId = getValue(row, ['ID (System)', 'ID Hệ thống']);
          if (systemId) {
            batch.update(doc(db, 'sessions', systemId), sessionData);
          } else {
            const newDoc = doc(collection(db, 'sessions'));
            batch.set(newDoc, sessionData);
          }
        }

        await batch.commit();
        setCopyStatus({
          show: true,
          message: "Đã import dữ liệu thành công!",
          isSuccess: true
        });
        e.target.value = '';
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'sessions');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  if (!campuses.length) return <EmptyState message="No campuses found. Please add one in Management." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif italic pl-12">Campus Dashboard</h1>
        <div className="flex items-center gap-4">
          <Button onClick={copyPreviousWeek} className="bg-white border border-black/10 hover:bg-black/5 flex items-center gap-2 text-xs py-2 px-3">
            <Copy size={16} />
            Copy Last Week
          </Button>
          <div className="flex items-center gap-2 bg-white rounded-xl border border-black/5 p-1 px-2 shadow-sm">
            <Button onClick={exportToExcel} className="p-2 text-black/60 hover:text-emerald-600 transition-colors flex items-center gap-2 text-xs">
              <Download size={16} /> Export
            </Button>
            <div className="w-px h-4 bg-black/10" />
            <label className="p-2 text-black/60 hover:text-emerald-600 transition-colors flex items-center gap-2 text-xs cursor-pointer">
              <Upload size={16} /> Import
              <input type="file" accept=".xlsx, .xls" className="hidden" onChange={importFromExcel} />
            </label>
          </div>
          <Button 
            onClick={() => onAddSession({})}
            className="bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-2"
          >
            <Plus size={18} />
            New Session
          </Button>
          <div className="flex items-center bg-white rounded-xl border border-black/5 p-1">
            <button onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} className="p-2 hover:bg-black/5 rounded-lg"><ChevronLeft size={16} /></button>
            <span className="px-4 text-sm font-medium">Week of {format(currentWeek, 'dd/MM/yyyy')}</span>
            <button onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))} className="p-2 hover:bg-black/5 rounded-lg"><ChevronRight size={16} /></button>
          </div>
          <Select value={selectedCampusId} onChange={(e) => setSelectedCampusId(e.target.value)} className="w-48">
            {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
      </div>

      {campus && (
        <div className="bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-120px)]">
            <table className="w-full border-separate border-spacing-0">
              <thead className="sticky top-0 z-20">
                <tr className="bg-black/5">
                  <th className="sticky top-0 left-0 z-30 bg-[#f8f8f8] p-4 border-r border-b border-black/5 text-left text-[11px] uppercase tracking-wider text-black/40 font-mono w-20 min-w-[80px] max-w-[80px]">Room</th>
                  <th className="sticky top-0 left-[80px] z-20 bg-[#f8f8f8] p-4 border-r border-b border-black/5 text-left text-[11px] uppercase tracking-wider text-black/40 font-mono w-[100px] min-w-[100px] max-w-[100px]">Slot</th>
                  {weekDays.map(day => (
                    <th key={day.toISOString()} className="sticky top-0 bg-[#f8f8f8] p-4 border-r border-b border-black/5 text-center min-w-[140px]">
                      <p className="text-xs font-semibold">{format(day, 'EEEE')}</p>
                      <p className="text-[10px] text-black/40">{format(day, 'dd/MM/yyyy')}</p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campus.rooms.map(room => (
                  <React.Fragment key={room}>
                    {SLOTS.map((slot, slotIdx) => (
                      <tr key={`${room}-${slot.id}`}>
                        {slotIdx === 0 && (
                          <td rowSpan={4} className="sticky left-0 z-10 p-4 border-r border-b border-black/5 font-mono text-sm bg-[#fafafa] align-middle text-center font-bold w-20 min-w-[80px] max-w-[80px]">
                            {room}
                          </td>
                        )}
                        <td className="sticky left-[80px] z-10 p-2 border-r border-b border-black/5 text-[10px] font-mono text-black/40 bg-[#fcfcfc] whitespace-nowrap align-middle w-[100px] min-w-[100px] max-w-[100px]">
                          {slot.label}
                        </td>
                        {weekDays.map(day => {
                          const slotSessions = sessions.filter(s => 
                            s.campusId === campus.id && 
                            s.room === room && 
                            isSameDay(parseISO(s.startTime), day) &&
                            safeFormat(s.startTime, 'HH:mm') === slot.start
                          );

                          return (
                            <td 
                              key={day.toISOString()} 
                              className="p-1 border-r border-b border-black/5 align-middle min-h-[80px] cursor-pointer hover:bg-black/[0.02] transition-colors"
                              onDoubleClick={() => handleDoubleClick(day, slot, room)}
                            >
                              <div className="flex flex-col gap-1 h-full">
                                {slotSessions.map(session => (
                                  <div 
                                    key={session.id}
                                    onClick={(e) => { e.stopPropagation(); onAddSession(session); }}
                                    className={cn(
                                      "p-2 border rounded-xl flex flex-col justify-center overflow-hidden transition-all relative",
                                      session.status === 'Done'
                                        ? "bg-gray-100 border-gray-200 opacity-60"
                                        : "bg-emerald-50 border-emerald-100 hover:bg-emerald-100"
                                    )}
                                  >
                                    <div className="flex items-center justify-between mb-0.5">
                                      <p className={cn(
                                        "font-bold leading-tight text-[10px]",
                                        session.status === 'Done' ? "text-gray-500" : "text-emerald-900"
                                      )}>
                                        {classes.find(c => c.id === session.classId)?.name}
                                      </p>
                                      {session.status === 'Done' && (
                                        <Check size={10} className="text-emerald-600" />
                                      )}
                                    </div>
                                    <p className={cn(
                                      "text-[9px] font-medium truncate",
                                      session.status === 'Done' ? "text-gray-400" : "text-emerald-700/70"
                                    )}>
                                      GV: {staff.find(st => st.staffId === session.teacherId)?.name}
                                    </p>
                                    {session.taId && (
                                      <p className="text-[8px] text-emerald-600/60 truncate">
                                        TA: {staff.find(st => st.staffId === session.taId)?.name}
                                      </p>
                                    )}
                                    {session.zoomId && <p className="text-[8px] text-emerald-500 font-mono truncate mt-0.5">Z: {session.zoomId}</p>}
                                    {session.attendanceStatus === 'Done' && (
                                      <div className="absolute bottom-1 right-1">
                                        <Check size={10} className="text-orange-500" />
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {slotSessions.length === 0 && (
                                  <div className="h-full w-full opacity-10" />
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {copyStatus.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-[32px] p-8 max-w-md w-full shadow-2xl border border-black/5 animate-in fade-in zoom-in duration-300">
            <div className="flex flex-col items-center text-center gap-6">
              <div className={cn(
                "w-16 h-16 rounded-2xl flex items-center justify-center",
                copyStatus.isLoading ? "bg-emerald-50 text-emerald-600 animate-pulse" : 
                copyStatus.isSuccess ? "bg-emerald-100 text-emerald-600" : "bg-black/5 text-black/40"
              )}>
                {copyStatus.isLoading ? (
                  <div className="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                ) : copyStatus.isSuccess ? (
                  <Check size={32} />
                ) : (
                  <Copy size={32} />
                )}
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl font-serif italic">
                  {copyStatus.isLoading ? 'Đang xử lý...' : 
                   copyStatus.isSuccess ? 'Thành công!' : 'Xác nhận copy'}
                </h3>
                <p className="text-sm text-black/60 leading-relaxed">
                  {copyStatus.message}
                </p>
              </div>

              <div className="flex items-center gap-3 w-full">
                {!copyStatus.isLoading && !copyStatus.isSuccess && (
                  <>
                    <Button 
                      onClick={() => setCopyStatus({ show: false, message: '' })}
                      className="flex-1 bg-black/5 text-black/60 hover:bg-black/10"
                    >
                      Hủy
                    </Button>
                    <Button 
                      onClick={copyStatus.onConfirm}
                      className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      Xác nhận
                    </Button>
                  </>
                )}
                {(copyStatus.isLoading || copyStatus.isSuccess) && (
                  <Button 
                    onClick={() => setCopyStatus({ show: false, message: '' })}
                    disabled={copyStatus.isLoading}
                    className="w-full bg-black/90 text-white hover:bg-black"
                  >
                    {copyStatus.isLoading ? 'Vui lòng đợi...' : 'Đóng'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- View: Scheduler ---

function Dashboard2View({ campuses, sessions, staff, classes, onAddSession }: { 
  campuses: Campus[], 
  sessions: Session[], 
  staff: Staff[], 
  classes: Class[],
  onAddSession: (data: Partial<Session>) => void
}) {
  const [selectedCampusId, setSelectedCampusId] = useState<string>('');
  const [currentWeek, setCurrentWeek] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));

  useEffect(() => {
    if (!selectedCampusId && campuses.length > 0) {
      setSelectedCampusId(campuses[0].id);
    }
  }, [campuses, selectedCampusId]);

  const campus = campuses.find(c => c.id === selectedCampusId);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i));

  if (!campuses.length) return <EmptyState message="No campuses found. Please add one in Management." />;

  const getSlotLabel = (start: string) => {
    if (start === '14:00') return 'CA CHIỀU 1';
    if (start === '15:30') return 'CA CHIỀU 2';
    if (start === '17:45') return 'CA TỐI 1';
    if (start === '19:30') return 'CA TỐI 2';
    return 'CA HỌC';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif italic pl-12">Office View</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-white rounded-xl border border-black/5 p-1">
            <button onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} className="p-2 hover:bg-black/5 rounded-lg"><ChevronLeft size={16} /></button>
            <span className="px-4 text-sm font-medium">Week of {format(currentWeek, 'dd/MM/yyyy')}</span>
            <button onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))} className="p-2 hover:bg-black/5 rounded-lg"><ChevronRight size={16} /></button>
          </div>
          <Select value={selectedCampusId} onChange={(e) => setSelectedCampusId(e.target.value)} className="w-48">
            {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
      </div>

      <div className="bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-120px)]">
          <table className="w-full border-separate border-spacing-0">
            <thead className="sticky top-0 z-20">
              <tr className="bg-black/5">
                <th className="sticky top-0 left-0 z-30 bg-[#f8f8f8] p-4 border-r border-b border-black/5 text-left text-[11px] uppercase tracking-wider text-black/40 font-mono w-40 min-w-[160px] max-w-[160px]">Ca học</th>
                {weekDays.map(day => (
                  <th key={day.toISOString()} className="sticky top-0 bg-[#f8f8f8] p-4 border-r border-b border-black/5 text-center min-w-[180px]">
                    <p className="text-xs font-semibold">{format(day, 'EEEE')}</p>
                    <p className="text-[10px] text-black/40">{format(day, 'dd/MM/yyyy')}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SLOTS.map((slot) => (
                <tr key={slot.id}>
                  <td className="sticky left-0 z-10 p-4 border-r border-b border-black/5 bg-[#fafafa] align-middle w-40 min-w-[160px] max-w-[160px]">
                    <p className="font-bold text-sm text-black/80">{getSlotLabel(slot.start)}</p>
                    <p className="text-[10px] text-black/40 font-mono mt-1 flex items-center gap-1">
                      <Calendar size={10} />
                      {slot.label}
                    </p>
                  </td>
                  {weekDays.map(day => {
                    const daySessions = sessions.filter(s => 
                      s.campusId === selectedCampusId && 
                      isSameDay(parseISO(s.startTime), day) &&
                      safeFormat(s.startTime, 'HH:mm') === slot.start
                    );

                    return (
                      <td 
                        key={day.toISOString()} 
                        className="p-2 border-r border-b border-black/5 align-top min-h-[120px]"
                      >
                        <div className="space-y-2">
                          {daySessions.map(session => (
                            <div 
                              key={session.id}
                              onClick={() => onAddSession(session)}
                              className={cn(
                                "p-3 border rounded-xl cursor-pointer transition-all hover:shadow-sm",
                                session.status === 'Done'
                                  ? "bg-gray-100 border-gray-200 opacity-60"
                                  : "bg-emerald-50 border-emerald-100 hover:bg-emerald-100"
                              )}
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <p className={cn(
                                  "font-bold text-xs uppercase tracking-tight",
                                  session.status === 'Done' ? "text-gray-500" : "text-emerald-900"
                                )}>
                                  {classes.find(c => c.id === session.classId)?.name}
                                </p>
                                {session.status === 'Done' && (
                                  <span className="text-[8px] bg-emerald-200 text-emerald-800 px-1 rounded font-bold uppercase flex items-center gap-0.5">
                                    <Check size={8} /> Done
                                  </span>
                                )}
                              </div>
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-[10px] text-emerald-700/70 font-medium">
                                  <span className="w-3.5 h-3.5 flex items-center justify-center bg-emerald-100 rounded text-[8px]">🏢</span>
                                  <span>Phòng {session.room}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 text-[10px] text-emerald-600/60">
                                    <span className="w-3.5 h-3.5 flex items-center justify-center bg-emerald-100 rounded text-[8px]">👤</span>
                                    <span className="truncate">{staff.find(st => st.staffId === session.teacherId)?.name}</span>
                                  </div>
                                  {session.attendanceStatus === 'Done' && (
                                    <span className="text-[8px] bg-orange-500 text-white px-1.5 py-0.5 rounded font-bold uppercase flex items-center gap-0.5">
                                      <Check size={8} /> DONE
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                          {daySessions.length === 0 && (
                            <div className="h-12 w-full opacity-5" />
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SchedulerView({ campuses, staff, classes, sessions, isModalOpen, setIsModalOpen, editingSession, setEditingSession }: { 
  campuses: Campus[], 
  staff: Staff[], 
  classes: Class[], 
  sessions: Session[],
  isModalOpen: boolean,
  setIsModalOpen: (open: boolean) => void,
  editingSession: Partial<Session> | null,
  setEditingSession: (s: Partial<Session> | null) => void
}) {
  const [selectedCampusId, setSelectedCampusId] = useState<string>(campuses[0]?.id || '');
  const [currentWeek, setCurrentWeek] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const campus = campuses.find(c => c.id === selectedCampusId);
  const weekStartStr = format(currentWeek, 'yyyy-MM-dd');

  const copyPreviousWeek = async () => {
    const prevWeekStart = format(subWeeks(currentWeek, 1), 'yyyy-MM-dd');
    const prevSessions = sessions.filter(s => s.weekStart === prevWeekStart);
    
    if (!prevSessions.length) {
      alert("No sessions found in the previous week.");
      return;
    }

    if (!confirm(`Copy ${prevSessions.length} sessions from last week?`)) return;

    const batch = writeBatch(db);
    prevSessions.forEach(s => {
      const { id, ...rest } = s;
      const newStartTime = addWeeks(parseISO(s.startTime), 1).toISOString();
      const newEndTime = addWeeks(parseISO(s.endTime), 1).toISOString();
      
      const newSessionRef = doc(collection(db, 'sessions'));
      batch.set(newSessionRef, {
        ...rest,
        startTime: newStartTime,
        endTime: newEndTime,
        weekStart: weekStartStr
      });
    });

    try {
      await batch.commit();
      alert("Copied sessions successfully!");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'sessions');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif italic pl-12">Admin Scheduler</h1>
        <div className="flex items-center gap-4">
          <Button onClick={copyPreviousWeek} className="bg-white border border-black/10 hover:bg-black/5 flex items-center gap-2 text-sm">
            <Copy size={16} />
            Copy Last Week
          </Button>
          <Button onClick={() => { 
            const now = new Date();
            now.setMinutes(0, 0, 0);
            const start = now.toISOString();
            const end = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
            setEditingSession({ campusId: selectedCampusId, startTime: start, endTime: end }); 
            setIsModalOpen(true); 
          }} className="bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-2">
            <Plus size={18} />
            Add Session
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-4 bg-white p-4 rounded-2xl border border-black/5">
        <div className="flex items-center bg-black/5 rounded-xl p-1">
          <button onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} className="p-2 hover:bg-black/10 rounded-lg"><ChevronLeft size={16} /></button>
          <span className="px-4 text-sm font-medium">Week of {format(currentWeek, 'dd/MM/yyyy')}</span>
          <button onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))} className="p-2 hover:bg-black/10 rounded-lg"><ChevronRight size={16} /></button>
        </div>
        <Select value={selectedCampusId} onChange={(e) => setSelectedCampusId(e.target.value)} className="w-48">
          {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sessions.filter(s => s.weekStart === weekStartStr && s.campusId === selectedCampusId)
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
          .map(s => (
            <div key={s.id} className="bg-white p-5 rounded-2xl border border-black/5 shadow-sm group relative">
              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                <button onClick={() => { setEditingSession(s); setIsModalOpen(true); }} className="p-2 hover:bg-black/5 rounded-lg text-black/40 hover:text-black"><Settings size={14} /></button>
                <button onClick={async () => {
                  if (confirm('Delete this session?')) {
                    try {
                      await deleteDoc(doc(db, 'sessions', s.id));
                    } catch (err) {
                      handleFirestoreError(err, OperationType.DELETE, 'sessions');
                    }
                  }
                }} className="p-2 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-black/30 mb-2">{s.room}</p>
              <h3 className="font-bold text-lg mb-1">{classes.find(c => c.id === s.classId)?.name || 'Unknown Class'}</h3>
              <p className="text-sm text-black/60 mb-4">
                {safeFormat(s.startTime, 'EEEE, HH:mm')} - {safeFormat(s.endTime, 'HH:mm')}
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-[10px] font-medium">GV: {staff.find(st => st.staffId === s.teacherId)?.name}</span>
                {s.taId && <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-medium">TA: {staff.find(st => st.staffId === s.taId)?.name}</span>}
                {s.zoomId && <span className="px-2 py-1 bg-black/5 text-black/60 rounded-lg text-[10px] font-mono">Zoom: {s.zoomId}</span>}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// --- View: Timetable Teacher View ---

function TimetableTeacherView({ staff, sessions, classes, campuses, userEmail, students, attendanceRecords }: {
  staff: Staff[],
  sessions: Session[],
  classes: Class[],
  campuses: Campus[],
  userEmail: string | null,
  students: Student[],
  attendanceRecords: AttendanceRecord[]
}) {
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [isMarkingOpen, setIsMarkingOpen] = useState(false);
  const [markingData, setMarkingData] = useState<Record<string, 'Present' | 'Absent'>>({});
  const [activeSession, setActiveSession] = useState<Session | null>(null);

  useEffect(() => {
    if (userEmail && !selectedStaffId) {
      const currentStaff = staff.find(s => s.email?.toLowerCase() === userEmail.toLowerCase());
      if (currentStaff) {
        setSelectedStaffId(currentStaff.staffId);
      }
    }
  }, [userEmail, staff, selectedStaffId]);

  const teacherSessions = useMemo(() => {
    if (!selectedStaffId) return [];
    return sessions
      .filter(s => 
        (s.teacherId === selectedStaffId || s.taId === selectedStaffId) && 
        safeFormat(s.startTime, 'yyyy-MM-dd') === selectedDate
      )
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [sessions, selectedStaffId, selectedDate]);

  const sortedStaff = useMemo(() => {
    return staff
      .filter(s => s.status === 'Working')
      .sort((a, b) => (a.staffId || '').localeCompare(b.staffId || ''));
  }, [staff]);

  const handleDoubleClick = (session: Session) => {
    const sessionClass = classes.find(c => c.id === session.classId);
    if (!sessionClass) return;

    const sessionDate = safeFormat(session.startTime, 'yyyy-MM-dd');
    const existingRecord = attendanceRecords.find(r => r.classId === session.classId && r.date === sessionDate);
    const initialData: Record<string, 'Present' | 'Absent'> = {};
    
    const classStudents = students
      .filter(s => s.classIds?.includes(session.classId) && (s.status === 'Study' || s.status === 'Trial'))
      .sort((a, b) => a.studentId.localeCompare(b.studentId));

    classStudents.forEach(s => {
      const studentStatus = existingRecord?.students.find(rs => rs.studentId === s.id)?.status;
      initialData[s.id] = studentStatus || 'Present';
    });
    
    setMarkingData(initialData);
    setActiveSession(session);
    setIsMarkingOpen(true);
  };

  const saveAttendance = async () => {
    if (!activeSession) return;
    const sessionDate = safeFormat(activeSession.startTime, 'yyyy-MM-dd');
    const existingRecord = attendanceRecords.find(r => r.classId === activeSession.classId && r.date === sessionDate);
    
    const recordData = {
      classId: activeSession.classId,
      date: sessionDate,
      students: Object.entries(markingData).map(([studentId, status]) => ({
        studentId,
        status
      }))
    };

    try {
      if (existingRecord) {
        await updateDoc(doc(db, 'attendanceRecords', existingRecord.id), recordData);
      } else {
        await addDoc(collection(db, 'attendanceRecords'), recordData);
      }

      // Update session status
      await updateDoc(doc(db, 'sessions', activeSession.id), { 
        attendanceStatus: 'Done',
        status: 'Done' 
      });

      setIsMarkingOpen(false);
      setActiveSession(null);
    } catch (err) {
      handleFirestoreError(err, existingRecord ? OperationType.UPDATE : OperationType.CREATE, 'attendanceRecords/sessions');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="w-full sm:w-auto">
          <Select 
            value={selectedStaffId} 
            onChange={(e) => setSelectedStaffId(e.target.value)} 
            className="w-full sm:w-48"
          >
            <option value="">Chọn nhân viên</option>
            {sortedStaff.map(s => (
              <option key={s.id} value={s.staffId}>
                {s.staffId} - {s.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2 bg-white rounded-xl border border-black/5 p-1 shadow-sm w-full sm:w-auto justify-between sm:justify-start">
          <button 
            onClick={() => {
              const d = parseISO(selectedDate);
              setSelectedDate(format(addDays(d, -1), 'yyyy-MM-dd'));
            }}
            className="p-2 hover:bg-black/5 rounded-lg transition-all"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="relative flex-1 sm:flex-initial">
            <input 
              type="date" 
              value={selectedDate} 
              onChange={e => setSelectedDate(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <span className="text-sm font-bold px-2 min-w-[100px] text-center block">
              {safeFormat(selectedDate, 'dd/MM/yyyy')}
            </span>
          </div>
          <button 
            className="p-2 hover:bg-black/5 rounded-lg transition-all"
            onClick={() => {
              const d = parseISO(selectedDate);
              setSelectedDate(format(addDays(d, 1), 'yyyy-MM-dd'));
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {teacherSessions.map(session => (
          <div 
            key={session.id}
            onDoubleClick={() => handleDoubleClick(session)}
            className={cn(
              "p-6 rounded-[32px] border border-black/5 shadow-sm hover:shadow-md transition-all group relative overflow-hidden cursor-pointer",
              session.status === 'Done' ? "bg-gray-50" : "bg-emerald-50/30"
            )}
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-xl font-bold text-black/80 truncate pr-2">
                {classes.find(c => c.id === session.classId)?.name || 'Unknown Class'}
              </h3>
              {session.status === 'Done' && (
                <span className="text-[10px] bg-emerald-100 text-emerald-600 px-2 py-1 rounded-lg font-bold uppercase flex items-center gap-1 shrink-0">
                  <Check size={10} /> DONE
                </span>
              )}
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-black/80 font-bold">
                <span className="w-5 h-5 flex items-center justify-center bg-white rounded shadow-sm">
                  <Clock size={12} className="text-emerald-600" />
                </span>
                <span>{safeFormat(session.startTime, 'HH:mm')} - {safeFormat(session.endTime, 'HH:mm')}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-black/40 font-medium">
                <span className="w-5 h-5 flex items-center justify-center bg-white rounded shadow-sm text-[10px]">🏢</span>
                <span>Phòng {session.room}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-black/40 font-medium">
                <span className="w-5 h-5 flex items-center justify-center bg-white rounded shadow-sm text-[10px]">📍</span>
                <span>{campuses.find(c => c.id === session.campusId)?.name}</span>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end">
              {session.attendanceStatus === 'Done' && (
                <span className="text-[10px] bg-orange-500 text-white px-2 py-1 rounded-lg font-bold uppercase flex items-center gap-1">
                  <Check size={10} /> DONE
                </span>
              )}
            </div>
          </div>
        ))}
        {teacherSessions.length === 0 && (
          <div className="col-span-full py-20 text-center bg-black/[0.02] rounded-[40px] border-2 border-dashed border-black/5">
            <p className="text-black/20 font-serif italic text-lg">Không có ca dạy nào trong ngày này</p>
          </div>
        )}
      </div>

      {isMarkingOpen && activeSession && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-[40px] shadow-2xl border border-black/5 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-8 border-b border-black/5 bg-gray-50/50 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Điểm danh lớp {classes.find(c => c.id === activeSession.classId)?.name}</h2>
                <p className="text-sm text-black/40 font-medium">Ngày {safeFormat(activeSession.startTime, 'dd/MM/yyyy')}</p>
              </div>
              <button onClick={() => setIsMarkingOpen(false)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>
            <div className="p-8 max-h-[60vh] overflow-auto">
              <div className="space-y-2">
                {students
                  .filter(s => s.classIds?.includes(activeSession.classId) && (s.status === 'Study' || s.status === 'Trial'))
                  .sort((a, b) => a.studentId.localeCompare(b.studentId))
                  .map((s, idx) => (
                    <div key={s.id} className="flex items-center justify-between p-4 bg-black/[0.02] rounded-2xl">
                      <div className="flex items-center gap-4">
                        <span className="text-xs font-mono text-black/30 w-6">{idx + 1}</span>
                        <div>
                          <p className="font-bold text-sm">{s.name}</p>
                          <p className="text-[10px] text-black/40 font-mono">{s.studentId}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setMarkingData({ ...markingData, [s.id]: 'Present' })}
                          className={cn(
                            "px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                            markingData[s.id] === 'Present' 
                              ? "bg-emerald-600 text-white border-emerald-600 shadow-md" 
                              : "bg-white text-black/40 border-black/10 hover:border-black/30"
                          )}
                        >
                          Có mặt
                        </button>
                        <button 
                          onClick={() => setMarkingData({ ...markingData, [s.id]: 'Absent' })}
                          className={cn(
                            "px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                            markingData[s.id] === 'Absent' 
                              ? "bg-red-600 text-white border-red-600 shadow-md" 
                              : "bg-white text-black/40 border-black/10 hover:border-black/30"
                          )}
                        >
                          Vắng mặt
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
            <div className="p-8 border-t border-black/5 flex gap-3">
              <Button onClick={() => setIsMarkingOpen(false)} className="flex-1 bg-black/5 hover:bg-black/10">Hủy</Button>
              <Button onClick={saveAttendance} className="flex-1 bg-blue-600 text-white hover:bg-blue-700">Lưu điểm danh</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- View: Staff View ---

function StaffView({ staff, sessions, classes, campuses, jobTitles }: { 
  staff: Staff[], 
  sessions: Session[], 
  classes: Class[], 
  campuses: Campus[],
  jobTitles: JobTitle[]
}) {
  const [currentWeek, setCurrentWeek] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif italic pl-12">Staff Schedule</h1>
        <div className="flex items-center bg-white rounded-xl border border-black/5 p-1">
          <button onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} className="p-2 hover:bg-black/5 rounded-lg"><ChevronLeft size={16} /></button>
          <span className="px-4 text-sm font-medium">Week of {format(currentWeek, 'dd/MM/yyyy')}</span>
          <button onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))} className="p-2 hover:bg-black/5 rounded-lg"><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-120px)]">
          <table className="w-full border-separate border-spacing-0">
            <thead className="sticky top-0 z-20">
              <tr className="bg-black/5">
                <th className="sticky top-0 left-0 z-30 bg-[#f8f8f8] p-4 border-r border-b border-black/5 text-left text-[11px] uppercase tracking-wider text-black/40 font-mono w-[150px] min-w-[150px] max-w-[150px]">Staff Member</th>
                <th className="sticky top-0 left-[150px] z-20 bg-[#f8f8f8] p-4 border-r border-b border-black/5 text-left text-[11px] uppercase tracking-wider text-black/40 font-mono w-[100px] min-w-[100px] max-w-[100px]">Slot</th>
                {weekDays.map(day => (
                  <th key={day.toISOString()} className="sticky top-0 bg-[#f8f8f8] p-4 border-r border-b border-black/5 text-center min-w-[140px]">
                    <p className="text-xs font-semibold">{format(day, 'EEEE')}</p>
                    <p className="text-[10px] text-black/40">{format(day, 'dd/MM/yyyy')}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.filter(member => member.status === 'Working').sort((a, b) => (a.staffId || '').localeCompare(b.staffId || '')).map(member => (
                <React.Fragment key={member.id}>
                  {SLOTS.map((slot, slotIdx) => (
                    <tr key={`${member.id}-${slot.id}`}>
                      {slotIdx === 0 && (
                        <td rowSpan={4} className="sticky left-0 z-10 p-4 border-r border-b border-black/5 bg-[#fafafa] align-middle w-[150px] min-w-[150px] max-w-[150px]">
                          <p className="font-bold text-sm">{member.name}</p>
                          <p className="text-[10px] text-black/40 uppercase tracking-widest">
                            {member.jobTitleIds?.map(id => jobTitles.find(jt => jt.id === id)?.name).join(', ')}
                          </p>
                          <p className="text-[9px] font-mono text-blue-600 font-bold">{member.staffId}</p>
                        </td>
                      )}
                      <td className="sticky left-[150px] z-10 p-2 border-r border-b border-black/5 text-[10px] font-mono text-black/40 bg-[#fcfcfc] whitespace-nowrap align-middle w-[100px] min-w-[100px] max-w-[100px]">
                        {slot.label}
                      </td>
                      {weekDays.map(day => {
                        const slotSessions = sessions.filter(s => 
                          (s.teacherId === member.staffId || s.taId === member.staffId) && 
                          isSameDay(parseISO(s.startTime), day) &&
                          safeFormat(s.startTime, 'HH:mm') === slot.start
                        );

                        return (
                          <td 
                            key={day.toISOString()} 
                            className="p-1 border-r border-b border-black/5 align-middle min-h-[80px] transition-colors"
                          >
                            <div className="flex flex-col gap-1 h-full">
                              {slotSessions.map(session => (
                                <div 
                                  key={session.id}
                                  className={cn(
                                    "p-2 border rounded-xl flex flex-col justify-center overflow-hidden transition-all relative",
                                    session.status === 'Done'
                                      ? "bg-gray-100 border-gray-200 opacity-60"
                                      : "bg-emerald-50 border-emerald-100"
                                  )}
                                >
                                  <div className="flex items-center justify-between mb-0.5">
                                    <p className={cn(
                                      "font-bold leading-tight text-[10px]",
                                      session.status === 'Done' ? "text-gray-500" : "text-emerald-900"
                                    )}>
                                      {classes.find(c => c.id === session.classId)?.name}
                                    </p>
                                    {session.status === 'Done' && (
                                      <Check size={10} className="text-emerald-600" />
                                    )}
                                  </div>
                                  <p className={cn(
                                    "text-[9px] font-medium truncate",
                                    session.status === 'Done' ? "text-gray-400" : "text-emerald-700/70"
                                  )}>
                                    {campuses.find(c => c.id === session.campusId)?.name} - {session.room}
                                  </p>
                                  {session.zoomId && <p className="text-[8px] text-emerald-500 font-mono truncate mt-0.5">Z: {session.zoomId}</p>}
                                  {session.attendanceStatus === 'Done' && (
                                    <div className="absolute bottom-1 right-1">
                                      <Check size={10} className="text-orange-500" />
                                    </div>
                                  )}
                                </div>
                              ))}
                              {slotSessions.length === 0 && (
                                <div className="h-full w-full opacity-10" />
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- View: Management (Campuses & Programs) ---

function ManagementView({ 
  campuses, 
  programs, 
  jobTitles, 
  departments,
  permissions,
  navStructure
}: { 
  campuses: Campus[], 
  programs: Program[], 
  jobTitles: JobTitle[], 
  departments: Department[],
  permissions: Permission[],
  navStructure: any[]
}) {
  const [newCampus, setNewCampus] = useState<{ id?: string, name: string, rooms: string }>({ name: '', rooms: '' });
  const [newProgram, setNewProgram] = useState<{ id?: string, name: string }>({ name: '' });
  const [newJobTitle, setNewJobTitle] = useState<{ id?: string, name: string }>({ name: '' });
  const [newDepartment, setNewDepartment] = useState<{ id?: string, name: string }>({ name: '' });

  const saveCampus = async () => {
    if (!newCampus.name || !newCampus.rooms) return;
    const rooms = String(newCampus.rooms || '').split(',').map(r => r.trim()).filter(r => r);
    const data = {
      name: newCampus.name,
      rooms: rooms
    };
    try {
      if (newCampus.id) {
        await updateDoc(doc(db, 'campuses', newCampus.id), data);
      } else {
        await addDoc(collection(db, 'campuses'), data);
      }
      setNewCampus({ name: '', rooms: '' });
    } catch (err) {
      handleFirestoreError(err, newCampus.id ? OperationType.UPDATE : OperationType.CREATE, 'campuses');
    }
  };

  const saveProgram = async () => {
    if (!newProgram.name) return;
    const data = { name: newProgram.name };
    try {
      if (newProgram.id) {
        await updateDoc(doc(db, 'programs', newProgram.id), data);
      } else {
        await addDoc(collection(db, 'programs'), data);
      }
      setNewProgram({ name: '' });
    } catch (err) {
      handleFirestoreError(err, newProgram.id ? OperationType.UPDATE : OperationType.CREATE, 'programs');
    }
  };

  const saveJobTitle = async () => {
    if (!newJobTitle.name) return;
    const data = { name: newJobTitle.name };
    try {
      if (newJobTitle.id) {
        await updateDoc(doc(db, 'jobTitles', newJobTitle.id), data);
      } else {
        await addDoc(collection(db, 'jobTitles'), data);
      }
      setNewJobTitle({ name: '' });
    } catch (err) {
      handleFirestoreError(err, newJobTitle.id ? OperationType.UPDATE : OperationType.CREATE, 'jobTitles');
    }
  };

  const saveDepartment = async () => {
    if (!newDepartment.name) return;
    const data = { name: newDepartment.name };
    try {
      if (newDepartment.id) {
        await updateDoc(doc(db, 'departments', newDepartment.id), data);
      } else {
        await addDoc(collection(db, 'departments'), data);
      }
      setNewDepartment({ name: '' });
    } catch (err) {
      handleFirestoreError(err, newDepartment.id ? OperationType.UPDATE : OperationType.CREATE, 'departments');
    }
  };

  const initDefaultPrograms = async () => {
    try {
      const defaults = ['TOEIC', 'IELTS', 'KID', 'KET-PET-FCE', 'GIAO TIẾP', 'OTHER'];
      for (const name of defaults) {
        if (!programs.find(p => p.name === name)) {
          await addDoc(collection(db, 'programs'), { name });
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'programs');
    }
  };

  const initDefaultJobTitles = async () => {
    try {
      const defaults = ['Teacher', 'CEO', 'Director', 'Team Leader', 'BOD', 'TA', 'Admin', 'Sale', 'Manager'];
      for (const name of defaults) {
        if (!jobTitles.find(j => j.name === name)) {
          await addDoc(collection(db, 'jobTitles'), { name });
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'jobTitles');
    }
  };

  const initDefaultDepartments = async () => {
    try {
      const defaults = ['TOEIC', 'IELTS', 'ADMIN', 'KIDS'];
      for (const name of defaults) {
        if (!departments.find(d => d.name === name)) {
          await addDoc(collection(db, 'departments'), { name });
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'departments');
    }
  };

  const deleteCampus = async (id: string) => {
    if (!confirm('Delete this campus?')) return;
    try {
      await deleteDoc(doc(db, 'campuses', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'campuses');
    }
  };

  const deleteProgram = async (id: string) => {
    if (!confirm('Delete this program?')) return;
    try {
      await deleteDoc(doc(db, 'programs', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'programs');
    }
  };

  const deleteJobTitle = async (id: string) => {
    if (!confirm('Delete this job title?')) return;
    try {
      await deleteDoc(doc(db, 'jobTitles', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'jobTitles');
    }
  };

  const deleteDepartment = async (id: string) => {
    if (!confirm('Delete this department?')) return;
    try {
      await deleteDoc(doc(db, 'departments', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'departments');
    }
  };

  const togglePermission = async (pageId: string, jobTitleId: string) => {
    try {
      const existing = permissions.find(p => p.pageId === pageId);
      if (existing) {
        const newJobTitleIds = existing.jobTitleIds?.includes(jobTitleId)
          ? existing.jobTitleIds.filter(id => id !== jobTitleId)
          : [...existing.jobTitleIds, jobTitleId];
        await updateDoc(doc(db, 'permissions', existing.id), { jobTitleIds: newJobTitleIds });
      } else {
        await addDoc(collection(db, 'permissions'), { pageId, jobTitleIds: [jobTitleId] });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'permissions');
    }
  };

  return (
    <div className="max-w-4xl space-y-12 pb-20">
      <h1 className="text-3xl font-serif italic pl-12">Management</h1>

      {/* Campuses */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <LayoutDashboard size={20} className="text-emerald-600" />
          Campuses & Rooms
        </h2>
        <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm space-y-6">
          <div className="flex gap-4">
            <Input placeholder="Campus Name (e.g. CS1)" value={newCampus.name} onChange={e => setNewCampus({...newCampus, name: e.target.value})} />
            <Input placeholder="Rooms (comma separated: 101, 102, 201)" value={newCampus.rooms} onChange={e => setNewCampus({...newCampus, rooms: e.target.value})} />
            <Button onClick={saveCampus} className="bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap">
              {newCampus.id ? 'Update' : 'Add Campus'}
            </Button>
            {newCampus.id && <Button onClick={() => setNewCampus({ name: '', rooms: '' })} className="bg-black/5 hover:bg-black/10">Cancel</Button>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[...campuses].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
              <div key={c.id} className="p-4 bg-black/5 rounded-2xl flex justify-between items-start">
                <div>
                  <p className="font-bold">{c.name}</p>
                  <p className="text-xs text-black/40">Rooms: {(c.rooms || []).join(', ')}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setNewCampus({ id: c.id, name: c.name, rooms: (c.rooms || []).join(', ') })} className="text-emerald-600 hover:text-emerald-700 p-1"><Settings size={16} /></button>
                  <button onClick={() => deleteCampus(c.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Programs */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <GraduationCap size={20} className="text-orange-600" />
            Programs
          </h2>
          {!programs.length && (
            <button onClick={initDefaultPrograms} className="text-xs text-emerald-600 hover:underline">Initialize Defaults</button>
          )}
        </div>
        <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm space-y-6">
          <div className="flex gap-4">
            <Input placeholder="Program Name (e.g. IELTS)" value={newProgram.name} onChange={e => setNewProgram({...newProgram, name: e.target.value})} />
            <Button onClick={saveProgram} className="bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap">
              {newProgram.id ? 'Update' : 'Add Program'}
            </Button>
            {newProgram.id && <Button onClick={() => setNewProgram({ name: '' })} className="bg-black/5 hover:bg-black/10">Cancel</Button>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[...programs].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
              <div key={p.id} className="p-4 bg-black/5 rounded-2xl flex justify-between items-center">
                <p className="font-bold text-sm">{p.name}</p>
                <div className="flex gap-2">
                  <button onClick={() => setNewProgram({ id: p.id, name: p.name })} className="text-emerald-600 hover:text-emerald-700 p-1"><Settings size={16} /></button>
                  <button onClick={() => deleteProgram(p.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Job Titles */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Briefcase size={20} className="text-blue-600" />
            Job Titles
          </h2>
          {!jobTitles.length && (
            <button onClick={initDefaultJobTitles} className="text-xs text-emerald-600 hover:underline">Initialize Defaults</button>
          )}
        </div>
        <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm space-y-6">
          <div className="flex gap-4">
            <Input placeholder="Job Title (e.g. Teacher)" value={newJobTitle.name} onChange={e => setNewJobTitle({...newJobTitle, name: e.target.value})} />
            <Button onClick={saveJobTitle} className="bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap">
              {newJobTitle.id ? 'Update' : 'Add Job Title'}
            </Button>
            {newJobTitle.id && <Button onClick={() => setNewJobTitle({ name: '' })} className="bg-black/5 hover:bg-black/10">Cancel</Button>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[...jobTitles].sort((a, b) => a.name.localeCompare(b.name)).map(j => (
              <div key={j.id} className="p-4 bg-black/5 rounded-2xl flex justify-between items-center">
                <p className="font-bold text-sm">{j.name}</p>
                <div className="flex gap-2">
                  <button onClick={() => setNewJobTitle({ id: j.id, name: j.name })} className="text-emerald-600 hover:text-emerald-700 p-1"><Settings size={16} /></button>
                  <button onClick={() => deleteJobTitle(j.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Departments */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Building2 size={20} className="text-purple-600" />
            Departments
          </h2>
          {!departments.length && (
            <button onClick={initDefaultDepartments} className="text-xs text-emerald-600 hover:underline">Initialize Defaults</button>
          )}
        </div>
        <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm space-y-6">
          <div className="flex gap-4">
            <Input placeholder="Department (e.g. IELTS)" value={newDepartment.name} onChange={e => setNewDepartment({...newDepartment, name: e.target.value})} />
            <Button onClick={saveDepartment} className="bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap">
              {newDepartment.id ? 'Update' : 'Add Department'}
            </Button>
            {newDepartment.id && <Button onClick={() => setNewDepartment({ name: '' })} className="bg-black/5 hover:bg-black/10">Cancel</Button>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[...departments].sort((a, b) => a.name.localeCompare(b.name)).map(d => (
              <div key={d.id} className="p-4 bg-black/5 rounded-2xl flex justify-between items-center">
                <p className="font-bold text-sm">{d.name}</p>
                <div className="flex gap-2">
                  <button onClick={() => setNewDepartment({ id: d.id, name: d.name })} className="text-emerald-600 hover:text-emerald-700 p-1"><Settings size={16} /></button>
                  <button onClick={() => deleteDepartment(d.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Permissions */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Shield size={20} className="text-purple-600" />
          Page Permissions
        </h2>
        <div className="bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-black/5 border-b border-black/5">
                  <th className="p-4 font-bold text-sm">Category / Page</th>
                  <th className="p-4 font-bold text-sm">Allowed Job Titles</th>
                </tr>
              </thead>
              <tbody>
                {navStructure.map((cat: any) => (
                  <React.Fragment key={cat.category}>
                    {/* Category Header Row (if it has sub-pages) */}
                    {cat.pages.length > 0 ? (
                      <tr className="bg-black/[0.02] border-b border-black/5">
                        <td colSpan={2} className="p-4 font-bold text-xs uppercase tracking-wider text-black/40 flex items-center gap-2">
                          {cat.icon}
                          {cat.category}
                        </td>
                      </tr>
                    ) : (
                      <tr className="border-b border-black/5 hover:bg-black/[0.01] transition-colors">
                        <td className="p-4 flex items-center gap-3">
                          <div className="p-2 bg-black/5 rounded-lg text-black/40">
                            {cat.icon}
                          </div>
                          <span className="font-bold">{cat.category}</span>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-3">
                            {jobTitles.map(jt => {
                              const isChecked = permissions.find(p => p.pageId === cat.id)?.jobTitleIds?.includes(jt.id) || false;
                              return (
                                <label key={jt.id} className="flex items-center gap-2 cursor-pointer group">
                                  <div 
                                    onClick={() => togglePermission(cat.id, jt.id)}
                                    className={cn(
                                      "w-5 h-5 rounded border flex items-center justify-center transition-all",
                                      isChecked ? "bg-purple-600 border-purple-600 text-white" : "border-black/10 group-hover:border-purple-400"
                                    )}
                                  >
                                    {isChecked && <Check size={12} strokeWidth={3} />}
                                  </div>
                                  <span className="text-sm">{jt.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Sub-pages Rows */}
                    {cat.pages.map((page: any) => (
                      <tr key={page.id} className="border-b border-black/5 hover:bg-black/[0.01] transition-colors">
                        <td className="p-4 pl-12 flex items-center gap-3">
                          <div className="p-2 bg-black/5 rounded-lg text-black/40">
                            {page.icon}
                          </div>
                          <span className="font-medium">{page.label}</span>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-3">
                            {jobTitles.map(jt => {
                              const isChecked = permissions.find(p => p.pageId === page.id)?.jobTitleIds?.includes(jt.id) || false;
                              return (
                                <label key={jt.id} className="flex items-center gap-2 cursor-pointer group">
                                  <div 
                                    onClick={() => togglePermission(page.id, jt.id)}
                                    className={cn(
                                      "w-5 h-5 rounded border flex items-center justify-center transition-all",
                                      isChecked ? "bg-purple-600 border-purple-600 text-white" : "border-black/10 group-hover:border-purple-400"
                                    )}
                                  >
                                    {isChecked && <Check size={12} strokeWidth={3} />}
                                  </div>
                                  <span className="text-sm">{jt.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

// --- View: Teacher (Staff Directory) ---

// --- View: Teacher (Staff Directory) ---

function LeaveTrackerView({ staff, leaveUsage }: { staff: Staff[], leaveUsage: LeaveUsage[] }) {
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [newLeaveDays, setNewLeaveDays] = useState<number>(1);
  const [newLeaveNote, setNewLeaveNote] = useState<string>('');
  const [editingLeave, setEditingLeave] = useState<LeaveUsage | null>(null);

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-11
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const calculateLeave = (s: Staff) => {
    // Phép năm nay: 6 days in first 6 months, 12 days in last 6 months
    const entitlement = currentMonth < 6 ? 6 : 12;
    
    // Phép bảo lưu: 0 for now as requested
    const carryOver = 0;
    
    // Phép đã nghỉ: total days used this year
    const usedThisYear = leaveUsage
      .filter(l => l.staffId === s.id && l.date.startsWith(currentYear.toString()))
      .reduce((acc, curr) => acc + curr.days, 0);

    return {
      entitlement,
      carryOver,
      used: usedThisYear,
      remaining: entitlement + carryOver - usedThisYear
    };
  };

  const workingStaff = staff
    .filter(s => s.status === 'Working')
    .sort((a, b) => (a.staffId || '').localeCompare(b.staffId || ''));

  const selectedStaff = staff.find(s => s.id === selectedStaffId);
  const selectedStaffLeaves = leaveUsage
    .filter(l => l.staffId === selectedStaffId && l.date.startsWith(currentYear.toString()))
    .sort((a, b) => b.date.localeCompare(a.date));

  const handleAddLeave = async () => {
    if (!selectedStaffId) return;
    try {
      await addDoc(collection(db, 'leaveUsage'), {
        staffId: selectedStaffId,
        date: todayStr,
        days: newLeaveDays,
        reason: newLeaveNote
      });
      setNewLeaveDays(1);
      setNewLeaveNote('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'leaveUsage');
    }
  };

  const handleUpdateLeave = async () => {
    if (!editingLeave) return;
    try {
      await updateDoc(doc(db, 'leaveUsage', editingLeave.id), {
        days: editingLeave.days,
        reason: editingLeave.reason
      });
      setEditingLeave(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'leaveUsage');
    }
  };

  const handleDeleteLeave = async (id: string) => {
    if (confirm('Are you sure you want to delete this leave entry?')) {
      try {
        await deleteDoc(doc(db, 'leaveUsage', id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, 'leaveUsage');
      }
    }
  };

  return (
    <div className="flex gap-6 flex-1 overflow-hidden">
      {/* Left Part: Staff Summary */}
      <div className="flex-[1.5] bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden flex flex-col">
        <div className="p-6 border-b border-black/5 flex justify-between items-center bg-gray-50/50">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Calendar size={20} className="text-blue-600" />
            Leave Summary ({currentYear})
          </h2>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-20 bg-gray-100 shadow-sm">
              <tr>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Họ và tên</th>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Phép bảo lưu</th>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Phép năm nay</th>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Phép đã nghỉ</th>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Số ngày nghỉ còn lại</th>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {workingStaff.map(s => {
                const stats = calculateLeave(s);
                const isSelected = selectedStaffId === s.id;
                return (
                  <tr key={s.id} className={cn("hover:bg-black/[0.02] transition-colors", isSelected && "bg-blue-50/50")}>
                    <td className="p-4">
                      <div className="font-bold text-sm">{s.name}</div>
                      <div className="text-[10px] text-black/40 font-mono">{s.staffId}</div>
                    </td>
                    <td className="p-4 text-sm">{stats.carryOver}</td>
                    <td className="p-4 text-sm">{stats.entitlement}</td>
                    <td className="p-4 text-sm text-orange-600 font-bold">{stats.used}</td>
                    <td className="p-4 text-sm text-emerald-600 font-bold">{stats.remaining}</td>
                    <td className="p-4">
                      <Button 
                        onClick={() => setSelectedStaffId(s.id)}
                        className={cn(
                          "text-[10px] px-3 py-1 h-auto",
                          isSelected ? "bg-blue-600 text-white" : "bg-black/5 text-black/60 hover:bg-black/10"
                        )}
                      >
                        Manage
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right Part: Staff Details & Add Leave */}
      <div className="flex-1 bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden flex flex-col">
        {selectedStaff ? (
          <>
            <div className="p-6 border-b border-black/5 bg-gray-50/50">
              <h2 className="text-lg font-bold truncate">{selectedStaff.name}</h2>
              <p className="text-xs text-black/40 font-mono">{selectedStaff.staffId}</p>
            </div>
            
            <div className="p-6 border-b border-black/5 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-black/30">Thêm ngày nghỉ phép</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Ngày nghỉ</label>
                  <Input value={todayStr} disabled className="bg-black/[0.02] cursor-not-allowed" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Số ngày nghỉ</label>
                  <Input 
                    type="number" 
                    step="0.5"
                    value={newLeaveDays} 
                    onChange={e => setNewLeaveDays(Number(e.target.value))} 
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Ghi chú</label>
                <Input 
                  placeholder="Lý do nghỉ phép..." 
                  value={newLeaveNote} 
                  onChange={e => setNewLeaveNote(e.target.value)} 
                />
              </div>
              <Button onClick={handleAddLeave} className="w-full bg-blue-600 text-white hover:bg-blue-700">
                <Plus size={16} className="mr-2" /> Thêm nghỉ phép
              </Button>
            </div>

            <div className="flex-1 overflow-auto">
              <div className="p-4 bg-gray-50 border-b border-black/5">
                <h3 className="text-xs font-bold uppercase tracking-widest text-black/30">Lịch sử nghỉ phép {currentYear}</h3>
              </div>
              <table className="w-full text-left border-collapse">
                <thead className="bg-white sticky top-0 z-10">
                  <tr>
                    <th className="p-3 text-[10px] font-bold uppercase text-black/40 border-b border-black/5">Ngày</th>
                    <th className="p-3 text-[10px] font-bold uppercase text-black/40 border-b border-black/5">Số ngày</th>
                    <th className="p-3 text-[10px] font-bold uppercase text-black/40 border-b border-black/5">Ghi chú</th>
                    <th className="p-3 text-[10px] font-bold uppercase text-black/40 border-b border-black/5">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {selectedStaffLeaves.map(l => (
                    <tr key={l.id} className="hover:bg-black/[0.01]">
                      <td className="p-3 text-xs font-mono">{l.date}</td>
                      <td className="p-3 text-xs">
                        {editingLeave?.id === l.id ? (
                          <Input 
                            type="number" 
                            step="0.5"
                            className="h-7 text-xs px-2"
                            value={editingLeave.days}
                            onChange={e => setEditingLeave({...editingLeave, days: Number(e.target.value)})}
                          />
                        ) : (
                          <span className="font-bold">{l.days}</span>
                        )}
                      </td>
                      <td className="p-3 text-xs">
                        {editingLeave?.id === l.id ? (
                          <Input 
                            className="h-7 text-xs px-2"
                            value={editingLeave.reason}
                            onChange={e => setEditingLeave({...editingLeave, reason: e.target.value})}
                          />
                        ) : (
                          <span className="text-black/60">{l.reason}</span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          {editingLeave?.id === l.id ? (
                            <>
                              <button onClick={handleUpdateLeave} className="text-emerald-600 hover:text-emerald-700 p-1">
                                <Check size={14} />
                              </button>
                              <button onClick={() => setEditingLeave(null)} className="text-red-600 hover:text-red-700 p-1">
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => setEditingLeave(l)} className="text-blue-600 hover:text-blue-700 p-1">
                                <Edit2 size={14} />
                              </button>
                              <button onClick={() => handleDeleteLeave(l.id)} className="text-red-600 hover:text-red-700 p-1">
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {selectedStaffLeaves.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-black/20 text-xs italic">
                        Chưa có dữ liệu nghỉ phép trong năm nay
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-black/20 p-12 text-center">
            <div className="w-16 h-16 bg-black/[0.02] rounded-full flex items-center justify-center mb-4">
              <Calendar size={32} />
            </div>
            <h3 className="text-sm font-bold text-black/40">Chọn nhân viên</h3>
            <p className="text-xs max-w-[200px] mt-2">Chọn nhân viên từ bảng bên trái để quản lý chi tiết nghỉ phép.</p>
          </div>
        )}
      </div>
    </div>
  );
}


function TimesheetView({ staff, sessions }: { staff: Staff[], sessions: Session[] }) {
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  const year = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const workingStaff = staff
    .filter(s => s.status === 'Working')
    .sort((a, b) => (a.staffId || '').localeCompare(b.staffId || ''));

  const doneSessions = sessions.filter(s => s.status === 'Done');

  const getSessionsCount = (staffId: string, day: number) => {
    return doneSessions.filter(s => {
      if (s.teacherId !== staffId && s.taId !== staffId) return false;
      const sessionDate = parseISO(s.startTime);
      return (
        sessionDate.getFullYear() === year &&
        sessionDate.getMonth() === month &&
        sessionDate.getDate() === day
      );
    }).length;
  };

  const getStaffTotal = (staffId: string) => {
    return doneSessions.filter(s => {
      if (s.teacherId !== staffId && s.taId !== staffId) return false;
      const sessionDate = parseISO(s.startTime);
      return (
        sessionDate.getFullYear() === year &&
        sessionDate.getMonth() === month
      );
    }).length;
  };

  const exportTimesheetToExcel = () => {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const dataToExport = workingStaff.map(s => {
      const row: any = {
        'Mã NV': s.staffId,
        'Họ và tên': s.name
      };
      
      for (let day = 1; day <= daysInMonth; day++) {
        const count = getSessionsCount(s.staffId, day);
        row[day.toString()] = count > 0 ? count : 0;
      }
      
      row['Tổng cộng'] = getStaffTotal(s.staffId);
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Timesheet");
    XLSX.writeFile(wb, `Timesheet_${month + 1}_${year}.xlsx`);
  };

  return (
    <div className="flex-1 bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden flex flex-col">
      <div className="p-6 border-b border-black/5 flex justify-between items-center bg-gray-50/50">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Calendar size={20} className="text-blue-600" />
          Bảng chấm công (Timesheet)
        </h2>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-black/5 p-1 rounded-xl">
            <button 
              onClick={() => setSelectedMonth(subMonths(selectedMonth, 1))}
              className="p-1.5 hover:bg-white rounded-lg transition-all"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-bold px-2 min-w-[120px] text-center">
              Tháng {month + 1} / {year}
            </span>
            <button 
              onClick={() => setSelectedMonth(addMonths(selectedMonth, 1))}
              className="p-1.5 hover:bg-white rounded-lg transition-all"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <Button 
            onClick={exportTimesheetToExcel}
            className="bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-2 text-xs py-2"
          >
            <Download size={16} />
            Export Excel
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-20 bg-gray-100 shadow-sm">
            <tr>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 sticky left-0 z-30 bg-gray-100 min-w-[200px]">Nhân viên</th>
              {monthDays.map(day => (
                <th key={day} className="p-2 text-[10px] font-bold text-center text-black/40 border-b border-black/5 min-w-[40px]">
                  {day}
                </th>
              ))}
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 text-center sticky right-0 z-30 bg-gray-100 min-w-[80px]">Tổng</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {workingStaff.map(s => (
              <tr key={s.id} className="hover:bg-black/[0.02] transition-colors group">
                <td className="p-4 text-sm font-bold sticky left-0 z-10 bg-white group-hover:bg-gray-50 border-r border-black/5">
                  <div className="flex flex-col">
                    <span>{s.name}</span>
                    <span className="text-[10px] text-black/40 font-mono">{s.staffId}</span>
                  </div>
                </td>
                {monthDays.map(day => {
                  const count = getSessionsCount(s.staffId, day);
                  return (
                    <td key={day} className={cn(
                      "p-2 text-xs text-center border-r border-black/5",
                      count > 0 ? "font-bold text-blue-600 bg-blue-50/30" : "text-black/10"
                    )}>
                      {count > 0 ? count : '-'}
                    </td>
                  );
                })}
                <td className="p-4 text-sm font-bold text-center sticky right-0 z-10 bg-white group-hover:bg-gray-50 border-l border-black/5 text-blue-700">
                  {getStaffTotal(s.staffId)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeacherView({ subTab, staff, jobTitles, departments, classes, sessions, leaveUsage }: { 
  subTab: 'summary' | 'details' | 'leave' | 'timesheet',
  staff: Staff[], 
  jobTitles: JobTitle[], 
  departments: Department[], 
  classes: Class[], 
  sessions: Session[],
  leaveUsage: LeaveUsage[]
}) {
  const [editingStaff, setEditingStaff] = useState<Partial<Staff> | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showResigned, setShowResigned] = useState(false);

  const sortedStaff = [...staff]
    .filter(s => showResigned || s.status === 'Working')
    .sort((a, b) => {
      // Working staff first
      if (a.status === 'Working' && b.status !== 'Working') return -1;
      if (a.status !== 'Working' && b.status === 'Working') return 1;
      
      // Then by staffId
      if (a.staffId && b.staffId) return a.staffId.localeCompare(b.staffId);
      return (a.name || '').localeCompare(b.name || '');
    });

  const generateNextStaffId = () => {
    const ids = staff.map(s => s.staffId).filter(id => id && id.startsWith('NV'));
    if (ids.length === 0) return 'NV001';
    const maxId = Math.max(...ids.map(id => parseInt(id.replace('NV', ''))));
    return `NV${(maxId + 1).toString().padStart(3, '0')}`;
  };

  const migrateStaffIds = async () => {
    try {
      const batch = writeBatch(db);
      const alphabetStaff = [...staff].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      
      const idMap: Record<string, string> = {}; // Old ID/StaffId -> New Staff ID (NVxxx)

      alphabetStaff.forEach((s, idx) => {
        const newStaffId = `NV${(idx + 1).toString().padStart(3, '0')}`;
        if (s.staffId) idMap[s.staffId] = newStaffId;
        idMap[s.id] = newStaffId;
        batch.update(doc(db, 'staff', s.id), { staffId: newStaffId });
      });

      // Update classes
      classes.forEach(c => {
        const updates: any = {};
        if (c.teacherId && idMap[c.teacherId]) updates.teacherId = idMap[c.teacherId];
        if (c.taId && idMap[c.taId]) updates.taId = idMap[c.taId];
        if (Object.keys(updates).length > 0) {
          batch.update(doc(db, 'classes', c.id), updates);
        }
      });

      // Update sessions
      sessions.forEach(s => {
        const updates: any = {};
        if (s.teacherId && idMap[s.teacherId]) updates.teacherId = idMap[s.teacherId];
        if (s.taId && idMap[s.taId]) updates.taId = idMap[s.taId];
        if (Object.keys(updates).length > 0) {
          batch.update(doc(db, 'sessions', s.id), updates);
        }
      });

      await batch.commit();
      alert("Migration complete! All staff assigned IDs and references updated.");
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'staff/classes/sessions');
    }
  };

  const fixSpecificStaffId = async () => {
    const target = staff.find(s => s.name === 'Nguyễn Trọng Quyết' || s.staffId === 'NV029');
    if (!target) {
      alert("Could not find staff member 'Nguyễn Trọng Quyết' or 'NV029'");
      return;
    }

    const batch = writeBatch(db);
    const oldId = target.staffId || target.id;
    const newId = 'NV001';

    // Update the staff member
    batch.update(doc(db, 'staff', target.id), { staffId: newId });

    // Update classes
    classes.forEach(c => {
      const updates: any = {};
      if (c.teacherId === oldId) updates.teacherId = newId;
      if (c.taId === oldId) updates.taId = newId;
      if (Object.keys(updates).length > 0) {
        batch.update(doc(db, 'classes', c.id), updates);
      }
    });

    // Update sessions
    sessions.forEach(s => {
      const updates: any = {};
      if (s.teacherId === oldId) updates.teacherId = newId;
      if (s.taId === oldId) updates.taId = newId;
      if (Object.keys(updates).length > 0) {
        batch.update(doc(db, 'sessions', s.id), updates);
      }
    });

    try {
      await batch.commit();
      alert(`Updated ${target.name} to ${newId} and updated all references.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'staff/classes/sessions');
    }
  };

  const exportToExcel = () => {
    const dataToExport = staff.map(s => ({
      'ID (System)': s.id,
      'Staff ID': s.staffId,
      'Full Name': s.name,
      'Status': s.status,
      'Gender': s.gender,
      'Birth Date': formatExcelDate(s.birthDate),
      'Phone': s.phone,
      'Email': s.email,
      'Address': s.address,
      'Citizen ID': s.citizenId,
      'Citizen ID Date': formatExcelDate(s.citizenIdDate),
      'Social Insurance ID': s.socialInsuranceId,
      'Health Insurance ID': s.healthInsuranceId,
      'Children Count': s.childrenCount,
      'Emergency Contact': s.emergencyContact,
      'Degrees': s.degrees,
      'Certificates': s.certificates,
      'Bank Account': s.bankAccount,
      'Bank Name': s.bankName
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Staff");
    XLSX.writeFile(wb, "Staff_Data.xlsx");
  };

  const importFromExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const data = evt.target?.result;
      const wb = XLSX.read(data, { type: 'array' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const jsonData = XLSX.utils.sheet_to_json(ws) as any[];

      const batch = writeBatch(db);
      
      for (const row of jsonData) {
        const staffData: any = {
          staffId: getValue(row, ['Staff ID', 'Mã nhân viên']) || '',
          name: getValue(row, ['Full Name', 'Họ và tên']) || '',
          status: getValue(row, ['Status', 'Trạng thái']) || 'Working',
          gender: getValue(row, ['Gender', 'Giới tính']) || 'Male',
          birthDate: normalizeImportDate(getValue(row, ['Birth Date', 'Ngày sinh'])),
          phone: getValue(row, ['Phone', 'Số điện thoại']) || '',
          email: getValue(row, ['Email']) || '',
          address: getValue(row, ['Address', 'Địa chỉ']) || '',
          citizenId: getValue(row, ['Citizen ID', 'Số CCCD']) || '',
          citizenIdDate: normalizeImportDate(getValue(row, ['Citizen ID Date', 'Ngày cấp CCCD'])),
          socialInsuranceId: getValue(row, ['Social Insurance ID', 'Mã số BHXH']) || '',
          healthInsuranceId: getValue(row, ['Health Insurance ID', 'Mã số BHYT']) || '',
          childrenCount: Number(getValue(row, ['Children Count', 'Số con'])) || 0,
          emergencyContact: getValue(row, ['Emergency Contact', 'Liên hệ khẩn cấp']) || '',
          degrees: getValue(row, ['Degrees', 'Bằng cấp']) || '',
          certificates: getValue(row, ['Certificates', 'Chứng chỉ']) || '',
          bankAccount: getValue(row, ['Bank Account', 'Số tài khoản']) || '',
          bankName: getValue(row, ['Bank Name', 'Ngân hàng']) || ''
        };

        const systemId = getValue(row, ['ID (System)', 'ID Hệ thống']);
        if (systemId) {
          batch.update(doc(db, 'staff', systemId), staffData);
        } else {
          // Check for duplicates by staffId or email
          const existing = staff.find(s => 
            (staffData.staffId && s.staffId === staffData.staffId) || 
            (staffData.email && s.email === staffData.email)
          );
          if (existing) {
            batch.update(doc(db, 'staff', existing.id), staffData);
          } else if (staffData.name) {
            const newDoc = doc(collection(db, 'staff'));
            batch.set(newDoc, staffData);
          }
        }
      }

      try {
        await batch.commit();
        alert("Import complete!");
        e.target.value = '';
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'staff');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const saveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStaff?.name) return;

    const data = {
      staffId: editingStaff.staffId || generateNextStaffId(),
      name: editingStaff.name,
      jobTitleIds: editingStaff.jobTitleIds || [],
      departmentIds: editingStaff.departmentIds || [],
      status: editingStaff.status || 'Working',
      gender: editingStaff.gender || 'Male',
      birthDate: editingStaff.birthDate || '',
      phone: editingStaff.phone || '',
      email: editingStaff.email || '',
      address: editingStaff.address || '',
      citizenId: editingStaff.citizenId || '',
      citizenIdDate: editingStaff.citizenIdDate || '',
      socialInsuranceId: editingStaff.socialInsuranceId || '',
      healthInsuranceId: editingStaff.healthInsuranceId || '',
      childrenCount: Number(editingStaff.childrenCount) || 0,
      emergencyContact: editingStaff.emergencyContact || '',
      degrees: editingStaff.degrees || '',
      certificates: editingStaff.certificates || '',
      bankAccount: editingStaff.bankAccount || '',
      bankName: editingStaff.bankName || ''
    };

    try {
      if (editingStaff.id) {
        await updateDoc(doc(db, 'staff', editingStaff.id), data);
      } else {
        await addDoc(collection(db, 'staff'), data);
      }
      setEditingStaff(null);
      setIsFormOpen(false);
    } catch (err) {
      handleFirestoreError(err, editingStaff.id ? OperationType.UPDATE : OperationType.CREATE, 'staff');
    }
  };

  const deleteStaff = async () => {
    if (!editingStaff?.id) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteDoc(doc(db, 'staff', editingStaff.id));
      setEditingStaff(null);
      setIsFormOpen(false);
      setConfirmDelete(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'staff');
    }
  };

  const toggleSelection = (field: 'jobTitleIds' | 'departmentIds', id: string) => {
    const current = editingStaff?.[field] || [];
    const next = current?.includes(id) ? current.filter(i => i !== id) : [...(current || []), id];
    setEditingStaff({ ...editingStaff, [field]: next });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-4">
      {subTab === 'summary' ? (
        <div className="flex-1 bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-black/5 flex justify-between items-center bg-gray-50/50">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Grid size={20} className="text-blue-600" />
              Staff Summary
            </h2>
            <div className="flex gap-3 items-center">
              <button onClick={exportToExcel} className="text-blue-600 hover:text-blue-800 flex items-center gap-1" title="Export to Excel">
                <Download size={14} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Export</span>
              </button>
              <label className="text-emerald-600 hover:text-emerald-800 flex items-center gap-1 cursor-pointer" title="Import from Excel">
                <Upload size={14} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Import</span>
                <input type="file" accept=".xlsx, .xls" className="hidden" onChange={importFromExcel} />
              </label>
            </div>
          </div>
          <div className="flex-1 overflow-auto relative">
            <table className="w-full text-left border-collapse min-w-[2500px]">
              <thead className="sticky top-0 z-20 bg-gray-100 shadow-sm">
                <tr>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 sticky left-0 z-30 bg-gray-100 w-[100px]">Staff ID</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 sticky left-[100px] z-30 bg-gray-100 w-[200px]">Full Name</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Status</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Gender</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Birth Date</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Phone</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Email</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Citizen ID</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Social Insurance</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Health Insurance</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Bank Account</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Bank Name</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Degrees</th>
                  <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {sortedStaff.map(s => (
                  <tr key={s.id} className="hover:bg-black/[0.02] transition-colors group">
                    <td className="p-4 text-sm font-mono text-blue-600 sticky left-0 z-10 bg-white group-hover:bg-gray-50">{s.staffId || '-'}</td>
                    <td className="p-4 text-sm font-bold sticky left-[100px] z-10 bg-white group-hover:bg-gray-50">{s.name}</td>
                    <td className="p-4 text-xs">
                      <span className={cn(
                        "px-2 py-1 rounded-full font-bold uppercase tracking-tighter",
                        s.status === 'Working' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                      )}>
                        {s.status}
                      </span>
                    </td>
                    <td className="p-4 text-sm">{s.gender}</td>
                    <td className="p-4 text-sm">{safeFormat(s.birthDate)}</td>
                    <td className="p-4 text-sm">{s.phone || '-'}</td>
                    <td className="p-4 text-sm">{s.email || '-'}</td>
                    <td className="p-4 text-sm">{s.citizenId || '-'}</td>
                    <td className="p-4 text-sm">{s.socialInsuranceId || '-'}</td>
                    <td className="p-4 text-sm">{s.healthInsuranceId || '-'}</td>
                    <td className="p-4 text-sm">{s.bankAccount || '-'}</td>
                    <td className="p-4 text-sm">{s.bankName || '-'}</td>
                    <td className="p-4 text-sm truncate max-w-[200px]">{s.degrees || '-'}</td>
                    <td className="p-4 text-sm truncate max-w-[300px]">{s.address || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : subTab === 'timesheet' ? (
        <TimesheetView staff={staff} sessions={sessions} />
      ) : subTab === 'details' ? (
        <div className="flex gap-6 flex-1 overflow-hidden">
          {/* Left: Staff List */}
          <div className="w-1/3 bg-white rounded-[32px] border border-black/5 shadow-sm flex flex-col overflow-hidden">
        <div className="p-6 border-b border-black/5 flex justify-between items-center bg-gray-50/50">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Users size={20} className="text-blue-600" />
              Staff
            </h2>
            <div className="flex gap-3 items-center">
              {staff.some(s => !s.staffId) && (
                <button onClick={migrateStaffIds} className="text-[10px] font-bold text-emerald-600 hover:underline uppercase tracking-wider">
                  Migrate IDs
                </button>
              )}
              <button 
                onClick={() => setShowResigned(!showResigned)}
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wider transition-colors",
                  showResigned ? "text-blue-600" : "text-black/40 hover:text-black/60"
                )}
              >
                {showResigned ? "Hide Resigned" : "Show All"}
              </button>
              <div className="flex items-center gap-2 ml-2 border-l border-black/10 pl-2">
                <button onClick={exportToExcel} className="text-blue-600 hover:text-blue-800 flex items-center gap-1" title="Export to Excel">
                  <Download size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Export</span>
                </button>
                <label className="text-emerald-600 hover:text-emerald-800 flex items-center gap-1 cursor-pointer" title="Import from Excel">
                  <Upload size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Import</span>
                  <input type="file" accept=".xlsx, .xls" className="hidden" onChange={importFromExcel} />
                </label>
              </div>
            </div>
          </div>
          <Button 
            onClick={() => { setEditingStaff({ status: 'Working', gender: 'Male', jobTitleIds: [], departmentIds: [] }); setIsFormOpen(true); setConfirmDelete(false); }}
            className="bg-emerald-600 text-white hover:bg-emerald-700 text-xs py-1.5 h-auto"
          >
            <Plus size={14} className="mr-1" /> Add Staff
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-2">
          {sortedStaff.map(s => (
            <div 
              key={s.id} 
              onClick={() => { setEditingStaff(s); setIsFormOpen(true); setConfirmDelete(false); }}
              className={cn(
                "p-3 rounded-xl flex justify-between items-center cursor-pointer transition-all border",
                editingStaff?.id === s.id ? "bg-blue-50 border-blue-200" : "bg-black/[0.02] border-transparent hover:bg-black/[0.05]",
                s.status === 'Resigned' && "opacity-50"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-xs">
                  {s.staffId?.replace('NV', '') || '??'}
                </div>
                <div>
                  <p className="font-bold text-sm">{s.name}</p>
                  <p className="text-[10px] text-black/40 font-mono">{s.staffId || 'No ID'}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-black/30">
                  {s.status}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Form */}
      <div className="w-2/3 bg-white rounded-[32px] border border-black/5 shadow-sm flex flex-col overflow-hidden">
        {isFormOpen ? (
          <form onSubmit={saveStaff} className="flex flex-col h-full">
            <div className="p-6 border-b border-black/5 bg-gray-50/50 flex justify-between items-center">
              <h2 className="text-xl font-bold">
                {editingStaff?.id ? `Edit Staff: ${editingStaff.staffId}` : 'New Staff'}
              </h2>
              {editingStaff?.staffId && (
                <span className="px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-[10px] font-bold tracking-widest">
                  {editingStaff.staffId}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto p-6 space-y-8">
              {/* Basic Info */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-black/30 border-b border-black/5 pb-2">Basic Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Full Name *</label>
                    <Input required value={editingStaff?.name || ''} onChange={e => setEditingStaff({...editingStaff, name: e.target.value})} placeholder="Họ và tên" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Status</label>
                    <Select value={editingStaff?.status || 'Working'} onChange={e => setEditingStaff({...editingStaff, status: e.target.value as any})}>
                      <option value="Working">Working</option>
                      <option value="Resigned">Resigned</option>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Gender</label>
                    <Select value={editingStaff?.gender || 'Male'} onChange={e => setEditingStaff({...editingStaff, gender: e.target.value as any})}>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Birth Date</label>
                    <Input 
                      placeholder="dd/mm/yyyy"
                      value={toDisplayDate(editingStaff?.birthDate || '')} 
                      onChange={e => setEditingStaff({...editingStaff, birthDate: fromDisplayDate(e.target.value)})} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Children (0-3)</label>
                    <Input type="number" min="0" max="3" value={editingStaff?.childrenCount || 0} onChange={e => setEditingStaff({...editingStaff, childrenCount: Number(e.target.value)})} />
                  </div>
                </div>
              </div>

              {/* Roles & Departments */}
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-black/30 border-b border-black/5 pb-2">Job Titles</h3>
                  <div className="flex flex-wrap gap-2">
                    {jobTitles.map(jt => (
                      <button
                        key={jt.id}
                        type="button"
                        onClick={() => toggleSelection('jobTitleIds', jt.id)}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all border",
                          editingStaff?.jobTitleIds?.includes(jt.id)
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-black/40 border-black/10 hover:border-black/30"
                        )}
                      >
                        {jt.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-black/30 border-b border-black/5 pb-2">Departments</h3>
                  <div className="flex flex-wrap gap-2">
                    {departments.map(dept => (
                      <button
                        key={dept.id}
                        type="button"
                        onClick={() => toggleSelection('departmentIds', dept.id)}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all border",
                          editingStaff?.departmentIds?.includes(dept.id)
                            ? "bg-purple-600 text-white border-purple-600"
                            : "bg-white text-black/40 border-black/10 hover:border-black/30"
                        )}
                      >
                        {dept.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-black/30 border-b border-black/5 pb-2">Contact & Address</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Phone</label>
                    <Input value={editingStaff?.phone || ''} onChange={e => setEditingStaff({...editingStaff, phone: e.target.value})} placeholder="Số điện thoại" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Email</label>
                    <Input type="email" value={editingStaff?.email || ''} onChange={e => setEditingStaff({...editingStaff, email: e.target.value})} placeholder="Email" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Current Address</label>
                  <Input value={editingStaff?.address || ''} onChange={e => setEditingStaff({...editingStaff, address: e.target.value})} placeholder="Địa chỉ hiện tại" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Emergency Contact</label>
                  <Input value={editingStaff?.emergencyContact || ''} onChange={e => setEditingStaff({...editingStaff, emergencyContact: e.target.value})} placeholder="Tên & SĐT người liên hệ" />
                </div>
              </div>

              {/* Identity & Insurance */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-black/30 border-b border-black/5 pb-2">Identity & Insurance</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Citizen ID (CCCD)</label>
                    <Input value={editingStaff?.citizenId || ''} onChange={e => setEditingStaff({...editingStaff, citizenId: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Issue Date</label>
                    <Input 
                      placeholder="dd/mm/yyyy"
                      value={toDisplayDate(editingStaff?.citizenIdDate || '')} 
                      onChange={e => setEditingStaff({...editingStaff, citizenIdDate: fromDisplayDate(e.target.value)})} 
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Social Insurance ID</label>
                    <Input value={editingStaff?.socialInsuranceId || ''} onChange={e => setEditingStaff({...editingStaff, socialInsuranceId: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Health Insurance ID</label>
                    <Input value={editingStaff?.healthInsuranceId || ''} onChange={e => setEditingStaff({...editingStaff, healthInsuranceId: e.target.value})} />
                  </div>
                </div>
              </div>

              {/* Qualifications */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-black/30 border-b border-black/5 pb-2">Qualifications</h3>
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Degrees</label>
                    <Input value={editingStaff?.degrees || ''} onChange={e => setEditingStaff({...editingStaff, degrees: e.target.value})} placeholder="Bằng cấp hiện có" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Certificates</label>
                    <Input value={editingStaff?.certificates || ''} onChange={e => setEditingStaff({...editingStaff, certificates: e.target.value})} placeholder="Chứng chỉ hiện có" />
                  </div>
                </div>
              </div>

              {/* Banking */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-black/30 border-b border-black/5 pb-2">Banking Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Account Number</label>
                    <Input value={editingStaff?.bankAccount || ''} onChange={e => setEditingStaff({...editingStaff, bankAccount: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Bank Name</label>
                    <Input value={editingStaff?.bankName || ''} onChange={e => setEditingStaff({...editingStaff, bankName: e.target.value})} />
                  </div>
                </div>
              </div>
            </div>
            <div className="p-6 border-t border-black/5 space-y-3">
              <div className="flex gap-3">
                <Button type="button" onClick={() => { setEditingStaff(null); setIsFormOpen(false); setConfirmDelete(false); }} className="flex-1 bg-black/5 hover:bg-black/10">Cancel</Button>
                <Button type="submit" className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700">Save Staff</Button>
              </div>
              {editingStaff?.id && (
                <button 
                  type="button" 
                  onClick={deleteStaff}
                  onMouseLeave={() => setConfirmDelete(false)}
                  className={cn(
                    "w-full py-2 text-xs rounded-xl transition-all flex items-center justify-center gap-2 border",
                    confirmDelete 
                      ? "bg-red-600 text-white border-red-600 font-bold animate-pulse" 
                      : "text-red-400 hover:text-red-600 hover:bg-red-50 border-transparent"
                  )}
                >
                  <Trash2 size={14} />
                  {confirmDelete ? 'Click again to confirm deletion' : 'Delete Staff'}
                </button>
              )}
            </div>
          </form>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-black/20 p-12 text-center">
            <div className="w-24 h-24 bg-black/[0.02] rounded-full flex items-center justify-center mb-4">
              <Users size={48} />
            </div>
            <h3 className="text-xl font-bold text-black/40">Select a staff member</h3>
            <p className="text-sm max-w-xs mt-2">Choose someone from the list to view or edit their full profile information.</p>
            <Button 
              onClick={() => { setEditingStaff({ status: 'Working', gender: 'Male', jobTitleIds: [], departmentIds: [] }); setIsFormOpen(true); setConfirmDelete(false); }}
              variant="outline"
              className="mt-6"
            >
              <Plus size={16} className="mr-2" /> Add New Staff
            </Button>
          </div>
        )}
      </div>
    </div>
  ) : (
    <LeaveTrackerView staff={staff} leaveUsage={leaveUsage} />
  )}
</div>
  );
}

// --- View: Course (Class Management) ---

function CourseDashboard({ classes, programs, staff, campuses }: { classes: Class[], programs: Program[], staff: Staff[], campuses: Campus[] }) {
  const [baseMonth, setBaseMonth] = useState(startOfMonth(new Date()));
  const [selectedClass, setSelectedClass] = useState<Class | null>(null);

  const months = [
    subMonths(baseMonth, 1),
    baseMonth,
    addMonths(baseMonth, 1),
    addMonths(baseMonth, 2),
  ];

  const startDate = startOfMonth(months[0]);
  const endDate = endOfMonth(months[3]);
  const totalDays = differenceInDays(endDate, startDate) + 1;

  const activeClasses = classes.filter(c => {
    if (c.status === 'Archived') return false;
    if (!c.startDate || !c.endDate) return false;
    try {
      const classEnd = parseISO(c.endDate);
      return isAfter(classEnd, new Date()) || isSameDay(classEnd, new Date());
    } catch (e) {
      return false;
    }
  });

  const sortedPrograms = [...programs].sort((a, b) => {
    if (a.name === "SẮP KHAI GIẢNG") return -1;
    if (b.name === "SẮP KHAI GIẢNG") return 1;
    return a.name.localeCompare(b.name);
  });

  const getProgramColor = (index: number) => {
    const colors = [
      'bg-blue-100 text-blue-800 border-blue-200',
      'bg-purple-100 text-purple-800 border-purple-200',
      'bg-emerald-100 text-emerald-800 border-emerald-200',
      'bg-orange-100 text-orange-800 border-orange-200',
      'bg-pink-100 text-pink-800 border-pink-200',
      'bg-indigo-100 text-indigo-800 border-indigo-200',
      'bg-amber-100 text-amber-800 border-amber-200',
    ];
    return colors[index % colors.length];
  };

  const getPosition = (dateStr: string) => {
    try {
      const date = parseISO(dateStr);
      if (isNaN(date.getTime())) return 0;
      if (isBefore(date, startDate)) return 0;
      if (isAfter(date, endDate)) return 100;
      const daysFromStart = differenceInDays(date, startDate);
      const pos = (daysFromStart / totalDays) * 100;
      return isNaN(pos) ? 0 : pos;
    } catch (e) {
      return 0;
    }
  };


  return (
    <div className="flex flex-col h-full bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-black/5 flex justify-between items-center bg-gray-50/50">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <LayoutDashboard size={20} className="text-blue-600" />
            Course Timeline
          </h2>
          <div className="flex items-center bg-white rounded-xl border border-black/5 p-1">
            <button onClick={() => setBaseMonth(subMonths(baseMonth, 1))} className="p-1.5 hover:bg-black/5 rounded-lg transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="px-4 text-xs font-bold uppercase tracking-wider">
              {format(baseMonth, 'MMMM yyyy')}
            </span>
            <button onClick={() => setBaseMonth(addMonths(baseMonth, 1))} className="p-1.5 hover:bg-black/5 rounded-lg transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="text-[10px] font-bold text-black/30 uppercase tracking-widest">
          Showing 4 Months: {format(months[0], 'MMM')} - {format(months[3], 'MMM')}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="min-w-[1000px] relative">
          {/* Timeline Header */}
          <div className="flex border-b border-black/5 sticky top-0 z-20 bg-white py-2 px-6 shadow-sm">
            {months.map(m => (
              <div key={m.toISOString()} className="flex-1 text-center py-2 border-r border-black/5 last:border-r-0">
                <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">
                  {format(m, 'MMMM yyyy')}
                </span>
              </div>
            ))}
          </div>

          <div className="p-6 pt-4">
            {/* Grid Lines */}
            <div className="absolute top-14 bottom-0 left-6 right-6 flex pointer-events-none">
              {months.map(m => (
                <div key={m.toISOString()} className="flex-1 border-r border-black/[0.03] last:border-r-0" />
              ))}
            </div>

            {/* Classes by Program */}
            <div className="space-y-12 relative z-10">
              {sortedPrograms.map((program, pIdx) => {
              const programClasses = activeClasses
                .filter(c => c.programId === program.id)
                .sort((a, b) => a.name.localeCompare(b.name));
              if (programClasses.length === 0) return null;

              return (
                <div key={program.id} className="space-y-4">
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/20 sticky left-0">
                    {program.name}
                  </h3>
                  <div className="space-y-6">
                    {programClasses.map(c => {
                      const left = getPosition(c.startDate);
                      const right = getPosition(c.endDate);
                      const width = Math.max(5, right - left);
                      const colorClass = getProgramColor(pIdx);
                      const teacher = staff.find(s => s.staffId === c.teacherId);

                      return (
                        <div key={c.id} className="relative h-12 flex items-center">
                          {/* Start Date Label */}
                          <div 
                            className="absolute text-[9px] font-mono text-black/30 whitespace-nowrap"
                            style={{ left: `${left}%`, transform: 'translateX(-110%)' }}
                          >
                            {safeFormat(c.startDate)}
                          </div>

                          {/* Bar */}
                          <div 
                            onClick={() => setSelectedClass(c)}
                            className={cn(
                              "absolute h-10 rounded-xl border shadow-sm cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md flex items-center px-4 overflow-hidden",
                              colorClass
                            )}
                            style={{ left: `${left}%`, width: `${width}%` }}
                          >
                            <div className="truncate w-full">
                              <p className="font-bold text-[11px] truncate">{c.name}</p>
                              <p className="text-[9px] opacity-70 truncate">{teacher?.name || 'No Teacher'}</p>
                            </div>
                          </div>

                          {/* End Date Label */}
                          <div 
                            className="absolute text-[9px] font-mono text-black/30 whitespace-nowrap"
                            style={{ left: `${right}%`, transform: 'translateX(10%)' }}
                          >
                            {safeFormat(c.endDate)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Uncategorized */}
            {activeClasses.filter(c => !c.programId || !programs.find(p => p.id === c.programId)).length > 0 && (
              <div className="space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-black/20 sticky left-0">
                  UNCATEGORIZED
                </h3>
                <div className="space-y-6">
                  {activeClasses
                    .filter(c => !c.programId || !programs.find(p => p.id === c.programId))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(c => {
                      const left = getPosition(c.startDate);
                      const right = getPosition(c.endDate);
                      const width = Math.max(5, right - left);
                      const colorClass = 'bg-gray-100 text-gray-800 border-gray-200';
                      const teacher = staff.find(s => s.staffId === c.teacherId);

                      return (
                        <div key={c.id} className="relative h-12 flex items-center">
                          <div 
                            className="absolute text-[9px] font-mono text-black/30 whitespace-nowrap"
                            style={{ left: `${left}%`, transform: 'translateX(-110%)' }}
                          >
                            {safeFormat(c.startDate)}
                          </div>
                          <div 
                            onClick={() => setSelectedClass(c)}
                            className={cn(
                              "absolute h-10 rounded-xl border shadow-sm cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md flex items-center px-4 overflow-hidden",
                              colorClass
                            )}
                            style={{ left: `${left}%`, width: `${width}%` }}
                          >
                            <div className="truncate w-full">
                              <p className="font-bold text-[11px] truncate">{c.name}</p>
                              <p className="text-[9px] opacity-70 truncate">{teacher?.name || 'No Teacher'}</p>
                            </div>
                          </div>
                          <div 
                            className="absolute text-[9px] font-mono text-black/30 whitespace-nowrap"
                            style={{ left: `${right}%`, transform: 'translateX(10%)' }}
                          >
                            {safeFormat(c.endDate)}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* Detail Modal (Read-only) */}
      {selectedClass && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-[40px] shadow-2xl border border-black/5 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-8 border-b border-black/5 bg-gray-50/50 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">{selectedClass.name}</h2>
                <p className="text-sm text-black/40 font-medium">Class Details (Read-only)</p>
              </div>
              <button onClick={() => setSelectedClass(null)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-1">Program</label>
                  <p className="font-medium">{programs.find(p => p.id === selectedClass.programId)?.name || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-1">Status</label>
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                    selectedClass.status === 'Active' ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"
                  )}>
                    {selectedClass.status}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-1">Teacher</label>
                  <p className="font-medium">{staff.find(s => s.staffId === selectedClass.teacherId)?.name || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-1">TA</label>
                  <p className="font-medium">{staff.find(s => s.staffId === selectedClass.taId)?.name || 'None'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-1">Start Date</label>
                  <p className="font-medium">{safeFormat(selectedClass.startDate)}</p>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-1">End Date</label>
                  <p className="font-medium">{safeFormat(selectedClass.endDate)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-8">
                <div>
                  <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-1">Học phí theo khóa</label>
                  <p className="font-medium text-emerald-600">
                    {selectedClass.tuitionFull ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(selectedClass.tuitionFull) : 'N/A'}
                  </p>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-1">Học phí theo tháng</label>
                  <p className="font-medium text-emerald-600">
                    {selectedClass.tuitionMonthly ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(selectedClass.tuitionMonthly) : 'N/A'}
                  </p>
                </div>
              </div>
              {selectedClass.schedule && selectedClass.schedule.length > 0 && (
                <div>
                  <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-2">Weekly Schedule</label>
                  <div className="flex flex-wrap gap-2">
                    {selectedClass.schedule.map((item, idx) => (
                      <div key={idx} className="px-3 py-1.5 bg-black/5 rounded-xl text-[11px] font-medium">
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][item.dayOfWeek]}: {item.slot}
                        <span className="ml-2 text-black/30 font-normal">
                          ({campuses.find(cp => cp.id === item.campusId)?.name || 'N/A'} - {item.room || 'N/A'})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="p-8 bg-gray-50/50 border-t border-black/5 flex justify-end">
              <Button onClick={() => setSelectedClass(null)} className="bg-black text-white px-8">Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CourseSummaryView({ classes, programs, staff, students }: { 
  classes: Class[], 
  programs: Program[], 
  staff: Staff[], 
  students: Student[] 
}) {
  const [selectedProgramId, setSelectedProgramId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('Active');

  const filteredClasses = classes.filter(c => {
    const matchesProgram = selectedProgramId === 'all' || c.programId === selectedProgramId;
    const matchesStatus = selectedStatus === 'all' || c.status === selectedStatus;
    return matchesProgram && matchesStatus;
  });

  const sortedPrograms = [...programs].sort((a, b) => {
    if (a.name === "SẮP KHAI GIẢNG") return -1;
    if (b.name === "SẮP KHAI GIẢNG") return 1;
    return a.name.localeCompare(b.name);
  });

  const getStudentsInClass = (classId: string) => {
    return students.filter(s => s.classIds?.includes(classId) && s.status === 'Study').length;
  };

  const formatSchedule = (schedule: ScheduleItem[]) => {
    if (!schedule || schedule.length === 0) return '-';
    return schedule.map(item => {
      const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][item.dayOfWeek];
      return `${day} (${item.slot})`;
    }).join(', ');
  };

  const totalClassesAll = filteredClasses.length;
  const totalStudentsAll = filteredClasses.reduce((acc, c) => acc + getStudentsInClass(c.id), 0);

  const renderClassRow = (c: Class) => {
    const teacher = staff.find(s => s.staffId === c.teacherId);
    const coTeacher = staff.find(s => s.staffId === c.coTeacherId);
    const ta = staff.find(s => s.staffId === c.taId);
    const studentCount = getStudentsInClass(c.id);

    return (
      <tr key={c.id} className="hover:bg-black/[0.02] transition-colors">
        <td className="p-4 text-sm font-medium">{c.name}</td>
        <td className="p-4 text-xs text-black/50">
          {safeFormat(c.startDate)} - {safeFormat(c.endDate)}
        </td>
        <td className="p-4 text-xs">
          <div className="flex flex-col">
            <span className="font-medium">{teacher?.name || 'N/A'}</span>
            {coTeacher && <span className="text-black/40 italic">Co: {coTeacher.name}</span>}
          </div>
        </td>
        <td className="p-4 text-xs text-black/50">{ta?.name || '-'}</td>
        <td className="p-4 text-sm text-center font-bold">{studentCount}</td>
        <td className="p-4 text-[10px] text-black/50 max-w-[200px] truncate">
          {formatSchedule(c.schedule)}
        </td>
        <td className="p-4">
          <span className={cn(
            "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
            c.status === 'Active' ? "bg-emerald-100 text-emerald-600" : "bg-gray-100 text-gray-400"
          )}>
            {c.status}
          </span>
        </td>
      </tr>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-black/5 bg-gray-50/50 flex justify-between items-center">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Grid size={20} className="text-emerald-600" />
          Course Summary
        </h2>
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-black/40 uppercase">Program:</label>
          <Select 
            value={selectedProgramId} 
            onChange={e => setSelectedProgramId(e.target.value)}
            className="w-48"
          >
            <option value="all">All Programs</option>
            {sortedPrograms.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <label className="text-xs font-bold text-black/40 uppercase ml-4">Status:</label>
          <Select 
            value={selectedStatus} 
            onChange={e => setSelectedStatus(e.target.value)}
            className="w-32"
          >
            <option value="Active">Active</option>
            <option value="Archived">Archived</option>
            <option value="all">All</option>
          </Select>
        </div>
      </div>

      {selectedProgramId === 'all' && (
        <div className="px-6 py-4 bg-emerald-50/50 border-b border-emerald-100/50 flex justify-center gap-16">
          <div className="text-center">
            <p className="text-[10px] font-bold text-emerald-600/60 uppercase tracking-widest mb-1">Total Classes</p>
            <p className="text-3xl font-black text-emerald-900">{totalClassesAll}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-emerald-600/60 uppercase tracking-widest mb-1">Total Active Students</p>
            <p className="text-3xl font-black text-emerald-900">{totalStudentsAll}</p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 z-20 bg-gray-100 shadow-sm">
            <tr>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Class Name</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Dates</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Teachers</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">TA</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 text-center">Students</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Schedule</th>
              <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {sortedPrograms.map(program => {
              const programClasses = filteredClasses
                .filter(c => c.programId === program.id)
                .sort((a, b) => a.name.localeCompare(b.name));
              
              if (programClasses.length === 0) return null;

              const totalStudentsProgram = programClasses.reduce((acc, c) => acc + getStudentsInClass(c.id), 0);

              return (
                <React.Fragment key={program.id}>
                  <tr className="bg-gray-100/80 font-bold border-t border-black/10">
                    <td className="p-4 text-sm uppercase tracking-wider text-black/70">
                      {program.name} ({programClasses.length} classes)
                    </td>
                    <td className="p-4"></td>
                    <td className="p-4"></td>
                    <td className="p-4"></td>
                    <td className="p-4 text-sm text-center text-black/70">{totalStudentsProgram}</td>
                    <td className="p-4"></td>
                    <td className="p-4"></td>
                  </tr>
                  {programClasses.map(c => renderClassRow(c))}
                </React.Fragment>
              );
            })}

            {/* Uncategorized */}
            {(() => {
              const uncategorizedClasses = filteredClasses
                .filter(c => !c.programId || !programs.find(p => p.id === c.programId))
                .sort((a, b) => a.name.localeCompare(b.name));
              
              if (uncategorizedClasses.length === 0) return null;

              const totalStudentsUncategorized = uncategorizedClasses.reduce((acc, c) => acc + getStudentsInClass(c.id), 0);

              return (
                <React.Fragment>
                  <tr className="bg-gray-100/80 font-bold border-t border-black/10">
                    <td className="p-4 text-sm uppercase tracking-wider text-black/70">
                      UNCATEGORIZED ({uncategorizedClasses.length} classes)
                    </td>
                    <td className="p-4"></td>
                    <td className="p-4"></td>
                    <td className="p-4"></td>
                    <td className="p-4 text-sm text-center text-black/70">{totalStudentsUncategorized}</td>
                    <td className="p-4"></td>
                    <td className="p-4"></td>
                  </tr>
                  {uncategorizedClasses.map(c => renderClassRow(c))}
                </React.Fragment>
              );
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CourseView({ subTab, classes, programs, staff, campuses, jobTitles, students, tuitionRecords, attendanceRecords, sessions }: { 
  subTab: 'dashboard' | 'details' | 'tuition' | 'attendance' | 'summary' | 'byClass',
  classes: Class[], programs: Program[], staff: Staff[], campuses: Campus[], jobTitles: JobTitle[],
  students: Student[], tuitionRecords: TuitionRecord[], attendanceRecords: AttendanceRecord[],
  sessions: Session[]
}) {
  const [editingClass, setEditingClass] = useState<Partial<Class> | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const exportToExcel = () => {
    const filteredClasses = showArchived ? classes : classes.filter(c => c.status === 'Active');
    const dataToExport = filteredClasses.map(c => {
      const program = programs.find(p => p.id === c.programId);
      const teacher = staff.find(s => s.staffId === c.teacherId);
      const coTeacher = staff.find(s => s.staffId === c.coTeacherId);
      const ta = staff.find(s => s.staffId === c.taId);

      return {
        'ID (System)': c.id,
        'Class Name': c.name,
        'Program': program?.name || '',
        'Status': c.status,
        'Teacher ID': c.teacherId || '',
        'Teacher Name': teacher?.name || '',
        'Co-Teacher ID': c.coTeacherId || '',
        'Co-Teacher Name': coTeacher?.name || '',
        'TA ID': c.taId || '',
        'TA Name': ta?.name || '',
        'Start Date': formatExcelDate(c.startDate),
        'End Date': formatExcelDate(c.endDate),
        'Tuition Full': c.tuitionFull,
        'Tuition Monthly': c.tuitionMonthly,
        'Schedule': JSON.stringify(c.schedule)
      };
    });

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Courses");
    XLSX.writeFile(wb, `Courses_${showArchived ? 'All' : 'Active'}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const importFromExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const data = evt.target?.result;
      const wb = XLSX.read(data, { type: 'array' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const jsonData = XLSX.utils.sheet_to_json(ws) as any[];

      const batch = writeBatch(db);
      
      for (const row of jsonData) {
        const classData: any = {
          name: getValue(row, ['Class Name', 'Tên lớp']) || '',
          programId: programs.find(p => p.name === getValue(row, ['Program', 'Chương trình']))?.id || '',
          status: getValue(row, ['Status', 'Trạng thái']) || 'Active',
          teacherId: getValue(row, ['Teacher ID', 'Mã GV']) || '',
          coTeacherId: getValue(row, ['Co-Teacher ID', 'Mã Co-GV']) || '',
          taId: getValue(row, ['TA ID', 'Mã TA']) || '',
          startDate: normalizeImportDate(getValue(row, ['Start Date', 'Ngày bắt đầu'])),
          endDate: normalizeImportDate(getValue(row, ['End Date', 'Ngày kết thúc'])),
          tuitionFull: Number(getValue(row, ['Tuition Full', 'Học phí trọn gói'])) || 0,
          tuitionMonthly: Number(getValue(row, ['Tuition Monthly', 'Học phí tháng'])) || 0,
          schedule: getValue(row, ['Schedule', 'Lịch học']) ? JSON.parse(getValue(row, ['Schedule', 'Lịch học'])) : []
        };

        const systemId = getValue(row, ['ID (System)', 'ID Hệ thống']);
        if (systemId) {
          batch.update(doc(db, 'classes', systemId), classData);
        } else {
          if (classData.name) {
            const newDoc = doc(collection(db, 'classes'));
            batch.set(newDoc, classData);
          }
        }
      }

      await batch.commit();
      alert("Import complete!");
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  };

  const saveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClass?.name || !editingClass?.programId || !editingClass?.teacherId) return;

    const data = {
      name: editingClass.name,
      programId: editingClass.programId,
      status: editingClass.status || 'Active',
      teacherId: editingClass.teacherId,
      coTeacherId: editingClass.coTeacherId || '',
      taId: editingClass.taId || '',
      startDate: editingClass.startDate || format(new Date(), 'yyyy-MM-dd'),
      endDate: editingClass.endDate || format(addWeeks(new Date(), 12), 'yyyy-MM-dd'),
      tuitionFull: Number(editingClass.tuitionFull) || 0,
      tuitionMonthly: Number(editingClass.tuitionMonthly) || 0,
      schedule: editingClass.schedule || []
    };

    if (editingClass.id) {
      await updateDoc(doc(db, 'classes', editingClass.id), data);
    } else {
      await addDoc(collection(db, 'classes'), data);
    }
    setEditingClass(null);
    setIsFormOpen(false);
  };

  const deleteClass = async () => {
    if (!editingClass?.id) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    
    await deleteDoc(doc(db, 'classes', editingClass.id));
    setEditingClass(null);
    setIsFormOpen(false);
    setConfirmDelete(false);
  };

  const addScheduleItem = () => {
    const newSchedule = [...(editingClass?.schedule || []), { dayOfWeek: 1, campusId: campuses[0]?.id || '', room: '', slot: 'CA TỐI 1' }];
    setEditingClass({ ...editingClass, schedule: newSchedule });
  };

  const removeScheduleItem = (index: number) => {
    const newSchedule = [...(editingClass?.schedule || [])];
    newSchedule.splice(index, 1);
    setEditingClass({ ...editingClass, schedule: newSchedule });
  };

  const updateScheduleItem = (index: number, field: keyof ScheduleItem, value: any) => {
    const newSchedule = [...(editingClass?.schedule || [])];
    newSchedule[index] = { ...newSchedule[index], [field]: value };
    setEditingClass({ ...editingClass, schedule: newSchedule });
  };

  const filteredClasses = showArchived ? classes : classes.filter(c => c.status === 'Active');

  const sortedPrograms = [...programs].sort((a, b) => {
    if (a.name === "SẮP KHAI GIẢNG") return -1;
    if (b.name === "SẮP KHAI GIẢNG") return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full">
      {subTab === 'summary' ? (
        <CourseSummaryView classes={classes} programs={programs} staff={staff} students={students} />
      ) : subTab === 'dashboard' ? (
        <CourseDashboard classes={classes} programs={programs} staff={staff} campuses={campuses} />
      ) : subTab === 'byClass' ? (
        <StudentView subTab="byClass" students={students} classes={classes} />
      ) : subTab === 'tuition' ? (
        <TuitionView classes={classes} students={students} tuitionRecords={tuitionRecords} />
      ) : subTab === 'attendance' ? (
        <AttendanceView classes={classes} students={students} attendanceRecords={attendanceRecords} sessions={sessions} />
      ) : (
        <div className="flex gap-6 flex-1 overflow-hidden">
          {/* Left: Class List grouped by Program */}
          <div className="w-1/2 bg-white rounded-[32px] border border-black/5 shadow-sm flex flex-col overflow-hidden">
            <div className="p-6 border-b border-black/5 flex justify-between items-center bg-gray-50/50">
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <BookOpen size={20} className="text-purple-600" />
                  Classes
                </h2>
                <button 
                  onClick={() => setShowArchived(!showArchived)}
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-wider text-left transition-colors",
                    showArchived ? "text-emerald-600" : "text-black/30 hover:text-black/50"
                  )}
                >
                  {showArchived ? "● Showing All" : "○ Show Archived"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-white rounded-xl border border-black/5 p-1 px-2 shadow-sm mr-2">
                  <Button onClick={exportToExcel} className="p-2 text-black/60 hover:text-emerald-600 transition-colors flex items-center gap-2 text-[10px] font-bold uppercase">
                    <Download size={14} /> Export
                  </Button>
                  <div className="w-px h-4 bg-black/10" />
                  <label className="p-2 text-black/60 hover:text-emerald-600 transition-colors flex items-center gap-2 text-[10px] font-bold uppercase cursor-pointer">
                    <Upload size={14} /> Import
                    <input type="file" accept=".xlsx, .xls" className="hidden" onChange={importFromExcel} />
                  </label>
                </div>
                <Button 
                  onClick={() => { setEditingClass({ status: 'Active', schedule: [] }); setIsFormOpen(true); setConfirmDelete(false); }}
                  className="bg-emerald-600 text-white hover:bg-emerald-700 text-xs py-1.5 h-auto"
                >
                  <Plus size={14} className="mr-1" /> Add Class
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-6">
              {sortedPrograms.map(program => {
                const programClasses = filteredClasses
                  .filter(c => c.programId === program.id)
                  .sort((a, b) => a.name.localeCompare(b.name));
                
                if (programClasses.length === 0) return null;
                return (
                  <div key={program.id} className="space-y-2">
                    <h3 className="text-[10px] uppercase tracking-widest font-bold text-black/30 px-2">{program.name}</h3>
                    <div className="space-y-1">
                      {programClasses.map(c => (
                        <div 
                          key={c.id} 
                          onClick={() => { setEditingClass(c); setIsFormOpen(true); setConfirmDelete(false); }}
                          className={cn(
                            "p-3 rounded-xl flex justify-between items-center cursor-pointer transition-all border",
                            editingClass?.id === c.id ? "bg-emerald-50 border-emerald-200" : "bg-black/[0.02] border-transparent hover:bg-black/[0.05]",
                            c.status === 'Archived' && "opacity-50"
                          )}
                        >
                          <div>
                            <p className="font-bold text-sm">{c.name}</p>
                            <p className="text-[10px] text-black/40">
                              {staff.find(s => s.staffId === c.teacherId)?.name || 'No Teacher'}
                              {c.coTeacherId && ` & ${staff.find(s => s.staffId === c.coTeacherId)?.name}`}
                              • {c.status} • {safeFormat(c.startDate)} - {safeFormat(c.endDate)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {filteredClasses.filter(c => !c.programId || !programs.find(p => p.id === c.programId)).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-widest font-bold text-black/30 px-2">Uncategorized</h3>
                  <div className="space-y-1">
                    {filteredClasses
                      .filter(c => !c.programId || !programs.find(p => p.id === c.programId))
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(c => (
                      <div 
                        key={c.id} 
                        onClick={() => { setEditingClass(c); setIsFormOpen(true); setConfirmDelete(false); }}
                        className={cn(
                          "p-3 rounded-xl flex justify-between items-center cursor-pointer transition-all border",
                          editingClass?.id === c.id ? "bg-emerald-50 border-emerald-200" : "bg-black/[0.02] border-transparent hover:bg-black/[0.05]"
                        )}
                      >
                        <div>
                          <p className="font-bold text-sm">{c.name}</p>
                          <p className="text-[10px] text-black/40">{c.status}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Add/Edit Form */}
          <div className="w-1/2 bg-white rounded-[32px] border border-black/5 shadow-sm flex flex-col overflow-hidden">
            {isFormOpen ? (
              <form onSubmit={saveClass} className="flex flex-col h-full">
                <div className="p-6 border-b border-black/5 bg-gray-50/50">
                  <h2 className="text-xl font-bold">
                    {editingClass?.id ? 'Edit Class' : 'New Class'}
                  </h2>
                </div>
                <div className="flex-1 overflow-auto p-6 space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Class Name</label>
                      <Input required value={editingClass?.name || ''} onChange={e => setEditingClass({...editingClass, name: e.target.value})} placeholder="e.g. IELTS 6.5" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Program</label>
                      <select required className="w-full bg-black/[0.02] border border-black/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all" value={editingClass?.programId || ''} onChange={e => setEditingClass({...editingClass, programId: e.target.value})}>
                        <option value="">Select Program</option>
                        {programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Teacher</label>
                      <select required className="w-full bg-black/[0.02] border border-black/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all" value={editingClass?.teacherId || ''} onChange={e => setEditingClass({...editingClass, teacherId: e.target.value})}>
                        <option value="">Select Teacher</option>
                        {staff.filter(s => s.jobTitleIds?.includes(jobTitles.find(jt => jt.name === 'Teacher')?.id || '') || s.jobTitleIds?.includes(jobTitles.find(jt => jt.name === 'Teacher')?.id || '')).map(s => <option key={s.staffId} value={s.staffId}>{s.staffId} - {s.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Co-Teacher (Optional)</label>
                      <select className="w-full bg-black/[0.02] border border-black/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all" value={editingClass?.coTeacherId || ''} onChange={e => setEditingClass({...editingClass, coTeacherId: e.target.value})}>
                        <option value="">Select Co-Teacher</option>
                        {staff.filter(s => s.jobTitleIds?.includes(jobTitles.find(jt => jt.name === 'Teacher')?.id || '')).map(s => <option key={s.staffId} value={s.staffId}>{s.staffId} - {s.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">TA (Optional)</label>
                      <select className="w-full bg-black/[0.02] border border-black/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all" value={editingClass?.taId || ''} onChange={e => setEditingClass({...editingClass, taId: e.target.value})}>
                        <option value="">Select TA</option>
                        {staff.filter(s => s.jobTitleIds?.includes(jobTitles.find(jt => jt.name === 'TA')?.id || '')).map(s => <option key={s.staffId} value={s.staffId}>{s.staffId} - {s.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Start Date (dd/mm/yyyy)</label>
                      <Input 
                        placeholder="dd/mm/yyyy"
                        value={toDisplayDate(editingClass?.startDate || '')} 
                        onChange={e => setEditingClass({...editingClass, startDate: fromDisplayDate(e.target.value)})} 
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">End Date (dd/mm/yyyy)</label>
                      <Input 
                        placeholder="dd/mm/yyyy"
                        value={toDisplayDate(editingClass?.endDate || '')} 
                        onChange={e => setEditingClass({...editingClass, endDate: fromDisplayDate(e.target.value)})} 
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Học phí theo khóa</label>
                      <Input type="number" value={editingClass?.tuitionFull || ''} onChange={e => setEditingClass({...editingClass, tuitionFull: Number(e.target.value)})} placeholder="VNĐ" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Học phí theo tháng</label>
                      <Input type="number" value={editingClass?.tuitionMonthly || ''} onChange={e => setEditingClass({...editingClass, tuitionMonthly: Number(e.target.value)})} placeholder="VNĐ" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Status</label>
                    <select className="w-full bg-black/[0.02] border border-black/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all" value={editingClass?.status || 'Active'} onChange={e => setEditingClass({...editingClass, status: e.target.value as any})}>
                      <option value="Active">Active</option>
                      <option value="Archived">Archived</option>
                    </select>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-black/5">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-bold">Weekly Schedule</h3>
                      <Button type="button" onClick={addScheduleItem} className="text-[10px] py-1 h-auto bg-black/5 hover:bg-black/10">
                        <Plus size={12} className="mr-1" /> Add Slot
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {(editingClass?.schedule || []).map((item, idx) => (
                        <div key={idx} className="p-4 bg-black/5 rounded-2xl space-y-3 relative group">
                          <button 
                            type="button" 
                            onClick={() => removeScheduleItem(idx)}
                            className="absolute top-2 right-2 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 size={14} />
                          </button>
                          <div className="grid grid-cols-2 gap-3">
                            <select className="w-full bg-white border border-black/5 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all" value={item.dayOfWeek} onChange={e => updateScheduleItem(idx, 'dayOfWeek', Number(e.target.value))}>
                              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, dIdx) => (
                                <option key={dIdx} value={dIdx}>{day}</option>
                              ))}
                            </select>
                            <select className="w-full bg-white border border-black/5 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all" value={item.slot} onChange={e => updateScheduleItem(idx, 'slot', e.target.value)}>
                              <option value="CA CHIỀU 1">CA CHIỀU 1</option>
                              <option value="CA CHIỀU 2">CA CHIỀU 2</option>
                              <option value="CA TỐI 1">CA TỐI 1</option>
                              <option value="CA TỐI 2">CA TỐI 2</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <select className="w-full bg-white border border-black/5 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all" value={item.campusId} onChange={e => updateScheduleItem(idx, 'campusId', e.target.value)}>
                              <option value="">Select Campus</option>
                              {campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <select className="w-full bg-white border border-black/5 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/20 transition-all" value={item.room} onChange={e => updateScheduleItem(idx, 'room', e.target.value)}>
                              <option value="">Select Room</option>
                              {campuses.find(c => c.id === item.campusId)?.rooms?.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </div>
                        </div>
                      ))}
                      {(!editingClass?.schedule || editingClass.schedule.length === 0) && (
                        <p className="text-center text-xs text-black/30 py-4 italic">No schedule items added.</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-black/5 space-y-3">
                  <div className="flex gap-3">
                    <Button type="button" onClick={() => { setEditingClass(null); setIsFormOpen(false); setConfirmDelete(false); }} className="flex-1 bg-black/5 hover:bg-black/10">Cancel</Button>
                    <Button type="submit" className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700">Save Class</Button>
                  </div>
                  {editingClass?.id && (
                    <button 
                      type="button" 
                      onClick={deleteClass}
                      onMouseLeave={() => setConfirmDelete(false)}
                      className={cn(
                        "w-full py-2 text-xs rounded-xl transition-all flex items-center justify-center gap-2 border",
                        confirmDelete 
                          ? "bg-red-600 text-white border-red-600 font-bold animate-pulse" 
                          : "text-red-400 hover:text-red-600 hover:bg-red-50 border-transparent"
                      )}
                    >
                      <Trash2 size={14} />
                      {confirmDelete ? 'Click again to confirm deletion' : 'Delete Class'}
                    </button>
                  )}
                </div>
              </form>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-12 opacity-30">
                <BookOpen size={48} className="mb-4" />
                <p className="text-sm font-medium">Select a class to edit or click "Add Class" to create a new one.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TuitionView({ classes, students, tuitionRecords }: { classes: Class[], students: Student[], tuitionRecords: TuitionRecord[] }) {
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [editingRecord, setEditingRecord] = useState<{ student: Student, month: string, record?: TuitionRecord } | null>(null);
  const [paymentDate, setPaymentDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [amount, setAmount] = useState<string>('');
  const [note, setNote] = useState<string>('');

  const activeClasses = classes.filter(c => c.status === 'Active').sort((a, b) => a.name.localeCompare(b.name));
  const selectedClass = classes.find(c => c.id === selectedClassId);

  const classStudents = students
    .filter(s => s.classIds?.includes(selectedClassId))
    .sort((a, b) => a.studentId.localeCompare(b.studentId));

  const months = useMemo(() => {
    if (!selectedClass) return [];
    const start = parseISO(selectedClass.startDate);
    const end = parseISO(selectedClass.endDate);
    const monthList = [];
    let current = startOfMonth(start);
    while (isBefore(current, end) || isSameDay(current, startOfMonth(end))) {
      monthList.push(format(current, 'yyyy-MM'));
      current = addMonths(current, 1);
    }
    return monthList;
  }, [selectedClass]);

  const handleSave = async () => {
    if (!editingRecord) return;
    const { student, month, record } = editingRecord;
    
    const cleanAmount = amount.trim().toUpperCase();
    if (cleanAmount !== 'DONE' && isNaN(Number(cleanAmount))) {
      return;
    }

    const data = {
      studentId: student.id,
      classId: selectedClassId,
      month,
      paymentDate,
      amount: cleanAmount === 'DONE' ? 'DONE' : Number(cleanAmount),
      note
    };

    try {
      if (record) {
        await updateDoc(doc(db, 'tuitionRecords', record.id), data);
      } else {
        await addDoc(collection(db, 'tuitionRecords'), data);
      }
      setEditingRecord(null);
    } catch (err) {
      handleFirestoreError(err, record ? OperationType.UPDATE : OperationType.CREATE, 'tuitionRecords');
    }
  };

  const handleDelete = async () => {
    if (!editingRecord?.record) return;
    try {
      await deleteDoc(doc(db, 'tuitionRecords', editingRecord.record.id));
      setEditingRecord(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'tuitionRecords');
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-black/5 bg-gray-50/50 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Briefcase size={20} className="text-emerald-600" />
            Tuition Class
          </h2>
          <Select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)} className="w-64">
            <option value="">Select Active Class</option>
            {activeClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-auto relative">
        {selectedClassId ? (
          <table className="w-full text-left border-collapse min-w-max">
            <thead className="sticky top-0 z-20 bg-gray-100 shadow-sm">
              <tr>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 sticky left-0 z-30 bg-gray-100 w-12">No.</th>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 sticky left-12 z-30 bg-gray-100 w-48">Student Name</th>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Status</th>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Phone</th>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5">Note</th>
                {months.map(m => (
                  <th key={m} className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 text-center min-w-[120px]">
                    {format(parseISO(m + '-01'), 'MMM yyyy')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {classStudents.map((s, idx) => (
                <tr key={s.id} className="hover:bg-black/[0.02] transition-colors group">
                  <td className="p-4 text-sm font-mono text-black/30 sticky left-0 z-10 bg-white group-hover:bg-gray-50 border-r border-black/5">{idx + 1}</td>
                  <td className="p-4 text-sm font-bold sticky left-12 z-10 bg-white group-hover:bg-gray-50 border-r border-black/5">{s.name}</td>
                  <td className="p-4 text-xs">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter",
                      s.status === 'Study' ? "bg-emerald-100 text-emerald-600" : "bg-gray-100 text-gray-400"
                    )}>
                      {s.status}
                    </span>
                  </td>
                  <td className="p-4 text-sm">{s.phone || '-'}</td>
                  <td className="p-4 text-sm truncate max-w-[150px]">{s.note || '-'}</td>
                  {months.map(m => {
                    const record = tuitionRecords.find(r => r.studentId === s.id && r.classId === selectedClassId && r.month === m);
                    return (
                      <td 
                        key={m} 
                        onDoubleClick={() => {
                          setEditingRecord({ student: s, month: m, record });
                          setPaymentDate(record?.paymentDate || format(new Date(), 'yyyy-MM-dd'));
                          setAmount(record?.amount?.toString() || '');
                          setNote(record?.note || '');
                        }}
                        className="p-4 text-sm text-center cursor-pointer hover:bg-emerald-50/50 transition-colors border-l border-black/5"
                      >
                        {record ? (
                          <div className="flex flex-col items-center">
                            <span className={cn(
                              "font-bold",
                              record.amount === 'DONE' ? "text-blue-600" : "text-emerald-600"
                            )}>
                              {record.amount === 'DONE' ? 'DONE' : new Intl.NumberFormat('vi-VN').format(record.amount as number)}
                            </span>
                            <span className="text-[9px] text-black/30">{safeFormat(record.paymentDate)}</span>
                          </div>
                        ) : (
                          <span className="text-black/10 italic text-xs">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-black/20 p-12 text-center">
            <Briefcase size={48} className="mb-4" />
            <h3 className="text-xl font-bold text-black/40">Select a class to manage tuition</h3>
          </div>
        )}
      </div>

      {editingRecord && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-[40px] shadow-2xl border border-black/5 w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-8 border-b border-black/5 bg-gray-50/50">
              <h2 className="text-2xl font-bold">Tuition Payment</h2>
              <p className="text-sm text-black/40 font-medium">{format(parseISO(editingRecord.month + '-01'), 'MMMM yyyy')}</p>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-1">Student ID</label>
                    <p className="font-mono text-sm">{editingRecord.student.studentId}</p>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-1">Class</label>
                    <p className="font-medium text-sm">{selectedClass?.name}</p>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-black/30 tracking-widest block mb-1">Student Name</label>
                  <p className="font-bold">{editingRecord.student.name}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Payment Date</label>
                  <Input 
                    type="date"
                    value={paymentDate} 
                    onChange={e => setPaymentDate(e.target.value)} 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Amount (Number or 'DONE')</label>
                  <Input 
                    value={amount} 
                    onChange={e => setAmount(e.target.value)} 
                    placeholder="e.g. 500000 or DONE"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Note</label>
                  <Input 
                    value={note} 
                    onChange={e => setNote(e.target.value)} 
                    placeholder="Optional note"
                  />
                </div>
              </div>
            </div>
            <div className="p-8 border-t border-black/5 flex flex-col gap-3">
              <div className="flex gap-3">
                <Button onClick={() => setEditingRecord(null)} className="flex-1 bg-black/5 hover:bg-black/10">Cancel</Button>
                <Button onClick={handleSave} className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700">Save</Button>
              </div>
              {editingRecord.record && (
                <Button onClick={handleDelete} className="w-full bg-red-50 text-red-600 hover:bg-red-100 border-red-100">Delete Record</Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AttendanceView({ classes, students, attendanceRecords, sessions }: { 
  classes: Class[], 
  students: Student[], 
  attendanceRecords: AttendanceRecord[],
  sessions: Session[]
}) {
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [isMarkingOpen, setIsMarkingOpen] = useState(false);
  const [markingData, setMarkingData] = useState<Record<string, 'Present' | 'Absent'>>({});

  const activeClasses = classes.filter(c => c.status === 'Active').sort((a, b) => a.name.localeCompare(b.name));
  
  // Classes that have sessions on the selected date
  const classesWithSessionsToday = useMemo(() => {
    const sessionClassIds = sessions
      .filter(s => safeFormat(s.startTime, 'yyyy-MM-dd') === selectedDate)
      .map(s => s.classId);
    return activeClasses.filter(c => sessionClassIds?.includes(c.id));
  }, [sessions, selectedDate, activeClasses]);

  const selectedClass = classes.find(c => c.id === selectedClassId);
  const classStudents = students
    .filter(s => s.classIds?.includes(selectedClassId) && (s.status === 'Study' || s.status === 'Trial'))
    .sort((a, b) => a.studentId.localeCompare(b.studentId));

  const attendanceHistoryDates = useMemo(() => {
    if (!selectedClassId) return [];
    
    // Get dates from attendance records
    const recordDates = attendanceRecords
      .filter(r => r.classId === selectedClassId)
      .map(r => r.date);
      
    // Get dates from sessions
    const sessionDates = sessions
      .filter(s => s.classId === selectedClassId)
      .map(s => safeFormat(s.startTime, 'yyyy-MM-dd'));
      
    const allDates = Array.from(new Set([...recordDates, ...sessionDates]))
      .sort((a, b) => a.localeCompare(b));
      
    return allDates;
  }, [attendanceRecords, selectedClassId, sessions]);

  const handleMarkAttendance = () => {
    if (!selectedClassId) return;
    const existingRecord = attendanceRecords.find(r => r.classId === selectedClassId && r.date === selectedDate);
    const initialData: Record<string, 'Present' | 'Absent'> = {};
    
    classStudents.forEach(s => {
      const studentStatus = existingRecord?.students.find(rs => rs.studentId === s.id)?.status;
      initialData[s.id] = studentStatus || 'Present';
    });
    
    setMarkingData(initialData);
    setIsMarkingOpen(true);
  };

  const saveAttendance = async () => {
    const existingRecord = attendanceRecords.find(r => r.classId === selectedClassId && r.date === selectedDate);
    const recordData = {
      classId: selectedClassId,
      date: selectedDate,
      students: Object.entries(markingData).map(([studentId, status]) => ({
        studentId,
        status
      }))
    };

    if (existingRecord) {
      await updateDoc(doc(db, 'attendanceRecords', existingRecord.id), recordData);
    } else {
      await addDoc(collection(db, 'attendanceRecords'), recordData);
    }

    // Update session status if exists
    const sessionToday = sessions.find(s => s.classId === selectedClassId && safeFormat(s.startTime, 'yyyy-MM-dd') === selectedDate);
    if (sessionToday) {
      await updateDoc(doc(db, 'sessions', sessionToday.id), { 
        attendanceStatus: 'Done',
        status: 'Done' 
      });
    }

    setIsMarkingOpen(false);
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden">
      <div className="p-6 border-b border-black/5 bg-gray-50/50 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Select value={selectedClassId} onChange={e => setSelectedClassId(e.target.value)} className="w-64">
            <option value="">Chọn lớp học</option>
            {classesWithSessionsToday.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Button 
            disabled={!selectedClassId}
            onClick={handleMarkAttendance}
            className="bg-blue-600 text-white hover:bg-blue-700 text-xs py-2"
          >
            Điểm danh
          </Button>
        </div>

        <div className="flex items-center gap-2 bg-black/5 p-1 rounded-xl">
          <button 
            onClick={() => {
              const d = parseISO(selectedDate);
              setSelectedDate(format(addDays(d, -1), 'yyyy-MM-dd'));
            }}
            className="p-1.5 hover:bg-white rounded-lg transition-all"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="relative">
            <input 
              type="date" 
              value={selectedDate} 
              onChange={e => setSelectedDate(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
            <span className="text-sm font-bold px-2 min-w-[120px] text-center block">
              {safeFormat(selectedDate, 'dd/MM/yyyy')}
            </span>
          </div>
          <button 
            className="p-1.5 hover:bg-white rounded-lg transition-all"
            onClick={() => {
              const d = parseISO(selectedDate);
              setSelectedDate(format(addDays(d, 1), 'yyyy-MM-dd'));
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto relative">
        {selectedClassId ? (
          <table className="w-full text-left border-collapse min-w-max">
            <thead className="sticky top-0 z-20 bg-gray-100 shadow-sm">
              <tr>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 sticky left-0 z-30 bg-gray-100 w-12 text-center">STT</th>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 sticky left-12 z-30 bg-gray-100 w-48">Học viên</th>
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 text-center">Status</th>
                {attendanceHistoryDates.map(date => (
                  <th key={date} className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 text-center min-w-[80px]">
                    {safeFormat(date, 'dd/MM')}
                  </th>
                ))}
                <th className="p-4 text-[10px] font-bold uppercase tracking-widest text-black/40 border-b border-black/5 text-center min-w-[100px] sticky right-0 z-30 bg-gray-100 shadow-[-4px_0_8px_rgba(0,0,0,0.05)]">Tổng (Học/Vắng)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {classStudents.map((s, idx) => {
                const studentRecords = attendanceRecords.filter(r => r.classId === selectedClassId);
                const totalPresent = studentRecords.filter(r => r.students.find(rs => rs.studentId === s.id)?.status === 'Present').length;
                const totalAbsences = studentRecords.filter(r => r.students.find(rs => rs.studentId === s.id)?.status === 'Absent').length;
                
                return (
                  <tr key={s.id} className="hover:bg-black/[0.02] transition-colors group">
                    <td className="p-4 text-sm font-mono text-black/30 sticky left-0 z-10 bg-white group-hover:bg-gray-50 border-r border-black/5 text-center">{idx + 1}</td>
                    <td className="p-4 text-sm font-bold sticky left-12 z-10 bg-white group-hover:bg-gray-50 border-r border-black/5">
                      <div className="flex flex-col">
                        <span>{s.name}</span>
                        <span className="text-[10px] text-black/40 font-mono">{s.studentId}</span>
                      </div>
                    </td>
                    <td className="p-4 text-xs text-center">
                      <span className={cn(
                        "px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter",
                        s.status === 'Study' ? "bg-emerald-100 text-emerald-600" : "bg-gray-100 text-gray-400"
                      )}>
                        {s.status}
                      </span>
                    </td>
                    {attendanceHistoryDates.map(date => {
                      const record = attendanceRecords.find(r => r.classId === selectedClassId && r.date === date);
                      const status = record?.students.find(rs => rs.studentId === s.id)?.status;
                      return (
                        <td key={date} className="p-4 text-sm text-center border-l border-black/5">
                          {status === 'Present' ? (
                            <Check size={16} className="text-emerald-600 mx-auto" />
                          ) : status === 'Absent' ? (
                            <X size={16} className="text-red-600 mx-auto" />
                          ) : (
                            <span className="text-black/10">-</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-4 text-sm font-bold text-center border-l border-black/5 sticky right-0 z-10 bg-white group-hover:bg-gray-50 shadow-[-4px_0_8px_rgba(0,0,0,0.05)]">
                      <span className="text-emerald-600">{totalPresent}</span>
                      <span className="text-black/20 mx-1">/</span>
                      <span className="text-red-600">{totalAbsences}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-black/20 p-12 text-center">
            <Check size={48} className="mb-4" />
            <h3 className="text-xl font-bold text-black/40">Chọn lớp để xem điểm danh</h3>
          </div>
        )}
      </div>

      {isMarkingOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-[40px] shadow-2xl border border-black/5 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-8 border-b border-black/5 bg-gray-50/50 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Điểm danh lớp {selectedClass?.name}</h2>
                <p className="text-sm text-black/40 font-medium">Ngày {safeFormat(selectedDate, 'dd/MM/yyyy')}</p>
              </div>
              <button onClick={() => setIsMarkingOpen(false)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>
            <div className="p-8 max-h-[60vh] overflow-auto">
              <div className="space-y-2">
                {classStudents.map((s, idx) => (
                  <div key={s.id} className="flex items-center justify-between p-4 bg-black/[0.02] rounded-2xl">
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-mono text-black/30 w-6">{idx + 1}</span>
                      <div>
                        <p className="font-bold text-sm">{s.name}</p>
                        <p className="text-[10px] text-black/40 font-mono">{s.studentId}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setMarkingData({ ...markingData, [s.id]: 'Present' })}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                          markingData[s.id] === 'Present' 
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-md" 
                            : "bg-white text-black/40 border-black/10 hover:border-black/30"
                        )}
                      >
                        Có mặt
                      </button>
                      <button 
                        onClick={() => setMarkingData({ ...markingData, [s.id]: 'Absent' })}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                          markingData[s.id] === 'Absent' 
                            ? "bg-red-600 text-white border-red-600 shadow-md" 
                            : "bg-white text-black/40 border-black/10 hover:border-black/30"
                        )}
                      >
                        Vắng mặt
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-8 border-t border-black/5 flex gap-3">
              <Button onClick={() => setIsMarkingOpen(false)} className="flex-1 bg-black/5 hover:bg-black/10">Hủy</Button>
              <Button onClick={saveAttendance} className="flex-1 bg-blue-600 text-white hover:bg-blue-700">Lưu điểm danh</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- View: Officer ---

function OfficerView({
  subTab,
  waitlist,
  staff,
  classes,
  jobTitles,
  students
}: {
  subTab: 'waitlist',
  waitlist: WaitlistEntry[],
  staff: Staff[],
  classes: Class[],
  jobTitles: JobTitle[],
  students: Student[]
}) {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingWaitlist, setEditingWaitlist] = useState<WaitlistEntry | null>(null);
  const [enrollingWaitlist, setEnrollingWaitlist] = useState<WaitlistEntry | null>(null);
  const [filterCycle, setFilterCycle] = useState<string>('all');
  const [filterConsultantId, setFilterConsultantId] = useState<string>('all');
  const [filterClassId, setFilterClassId] = useState<string>('all');

  // For Enrollment Form
  const [enrollData, setEnrollData] = useState<Partial<Student>>({});

  // Find job title ID for "Consultant"
  const consultantJobTitle = jobTitles.find(jt => jt.name.toLowerCase().includes('consultant'));
  const consultants = staff.filter(s => s.jobTitleIds?.includes(consultantJobTitle?.id || ''));

  // Derive available cycles from waitlist
  const cycles = useMemo(() => {
    const set = new Set<string>();
    waitlist.forEach(item => {
      if (item.createdAt) {
        set.add(safeFormat(item.createdAt, 'MM/yyyy'));
      }
    });
    return Array.from(set).sort((a, b) => {
      const [mA, yA] = a.split('/').map(Number);
      const [mB, yB] = b.split('/').map(Number);
      return yB !== yA ? yB - yA : mB - mA;
    });
  }, [waitlist]);

  const handleSaveWaitlist = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data: Partial<WaitlistEntry> = {
      name: formData.get('name') as string,
      phone: formData.get('phone') as string,
      source: formData.get('source') as any,
      consultantId: formData.get('consultantId') as string,
      desiredClassId: (formData.get('desiredClassId') as string) || null,
      referrerStaffId: (formData.get('referrerStaffId') as string) || null,
      notes: formData.get('notes') as string
    };

    try {
      if (editingWaitlist) {
        await updateDoc(doc(db, 'waitlist', editingWaitlist.id), data);
      } else {
        await addDoc(collection(db, 'waitlist'), {
          ...data,
          consultationCount: 1,
          status: 'Waiting',
          createdAt: new Date().toISOString()
        });
      }
      setIsAddModalOpen(false);
      setEditingWaitlist(null);
    } catch (err) {
      handleFirestoreError(err, editingWaitlist ? OperationType.UPDATE : OperationType.CREATE, 'waitlist');
    }
  };

  const handleUpdateConsultation = async (id: string, currentCount: number) => {
    if (currentCount >= 3) return;
    try {
      await updateDoc(doc(db, 'waitlist', id), {
        consultationCount: (currentCount + 1) as any
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'waitlist');
    }
  };

  const handleMarkFailed = async (id: string) => {
    try {
      await updateDoc(doc(db, 'waitlist', id), {
        status: 'Failed'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'waitlist');
    }
  };

  const handleEnrollSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollingWaitlist || !enrollData.name) return;

    try {
      // 1. Generate Student ID
      const lastStudent = [...students].sort((a, b) => b.studentId.localeCompare(a.studentId))[0];
      const nextId = lastStudent 
        ? `HV${(parseInt(lastStudent.studentId.replace('HV', '')) + 1).toString().padStart(6, '0')}`
        : 'HV000001';

      // 2. Create Student
      const studentData = {
        ...enrollData,
        studentId: nextId,
        createdAt: new Date().toISOString()
      };
      await addDoc(collection(db, 'students'), studentData);

      // 3. Update Waitlist Status
      await updateDoc(doc(db, 'waitlist', enrollingWaitlist.id), {
        status: 'Enrolled'
      });

      setEnrollingWaitlist(null);
      setEnrollData({});
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'waitlist/enroll');
    }
  };

  const filteredWaitlist = waitlist
    .filter(item => item.status === 'Waiting')
    .filter(item => filterConsultantId === 'all' || item.consultantId === filterConsultantId)
    .filter(item => filterClassId === 'all' || item.desiredClassId === filterClassId)
    .filter(item => filterCycle === 'all' || safeFormat(item.createdAt, 'MM/yyyy') === filterCycle)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pl-12">
        <h1 className="text-3xl font-serif italic">Officer: Waitlist</h1>
        <Button 
          onClick={() => setIsAddModalOpen(true)}
          className="bg-emerald-600 text-white hover:bg-emerald-700 rounded-2xl px-6"
        >
          Add Potential Student
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 bg-white p-6 rounded-[32px] border border-black/5 shadow-sm">
        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] uppercase font-bold text-black/40 mb-2 block">Filter by Cycle</label>
          <select 
            value={filterCycle} 
            onChange={(e) => setFilterCycle(e.target.value)}
            className="w-full bg-black/[0.02] border-none rounded-xl text-sm p-3"
          >
            <option value="all">All Cycles</option>
            {cycles.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] uppercase font-bold text-black/40 mb-2 block">Consultant</label>
          <select 
            value={filterConsultantId} 
            onChange={(e) => setFilterConsultantId(e.target.value)}
            className="w-full bg-black/[0.02] border-none rounded-xl text-sm p-3"
          >
            <option value="all">All Consultants</option>
            {consultants.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] uppercase font-bold text-black/40 mb-2 block">Desired Class</label>
          <select 
            value={filterClassId} 
            onChange={(e) => setFilterClassId(e.target.value)}
            className="w-full bg-black/[0.02] border-none rounded-xl text-sm p-3"
          >
            <option value="all">All Classes</option>
            {classes.filter(c => c.status === 'Active').map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Waitlist Table */}
      <div className="bg-white rounded-[40px] border border-black/5 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/5">
                <th className="p-6 text-[10px] uppercase font-bold text-black/40">Student Info</th>
                <th className="p-6 text-[10px] uppercase font-bold text-black/40">Phone Number</th>
                <th className="p-6 text-[10px] uppercase font-bold text-black/40">Source / Referrer</th>
                <th className="p-6 text-[10px] uppercase font-bold text-black/40">Consultant</th>
                <th className="p-6 text-[10px] uppercase font-bold text-black/40">Desired Class</th>
                <th className="p-6 text-[10px] uppercase font-bold text-black/40">Status (Cycle)</th>
                <th className="p-6 text-[10px] uppercase font-bold text-black/40">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.02]">
              {filteredWaitlist.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-black/40 font-serif italic">No students in waitlist</td>
                </tr>
              ) : (
                filteredWaitlist.map(entry => (
                  <tr key={entry.id} className="hover:bg-black/[0.01] transition-colors">
                    <td className="p-6">
                      <p className="font-bold text-sm">{entry.name}</p>
                      <p className="text-[10px] text-black/30 font-mono">ID: {entry.id.substring(0, 6).toUpperCase()}</p>
                    </td>
                    <td className="p-6">
                      <p className="font-mono text-sm text-blue-600 font-bold">{entry.phone}</p>
                    </td>
                    <td className="p-6">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                          entry.source === 'Direct' ? "bg-emerald-50 text-emerald-600" :
                          entry.source === 'Zalo' ? "bg-blue-50 text-blue-600" :
                          entry.source === 'Facebook' ? "bg-indigo-50 text-indigo-600" :
                          "bg-gray-50 text-gray-600"
                        )}>
                          {entry.source}
                        </span>
                        {entry.referrerStaffId && (
                          <span className="text-[10px] text-black/40 italic">
                            via {staff.find(s => s.id === entry.referrerStaffId)?.name}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-6">
                      <p className="text-sm font-medium">{staff.find(s => s.id === entry.consultantId)?.name}</p>
                    </td>
                    <td className="p-6">
                      <p className="text-sm">{classes.find(c => c.id === entry.desiredClassId)?.name || 'Not specified'}</p>
                    </td>
                    <td className="p-6">
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-1">
                          {[1, 2, 3].map(i => (
                            <div 
                              key={i} 
                              className={cn(
                                "w-6 h-1.5 rounded-full",
                                i <= entry.consultationCount ? "bg-emerald-500" : "bg-black/5"
                              )}
                            />
                          ))}
                        </div>
                        <p className="text-[10px] font-bold text-black/40 uppercase">
                          Consultation {entry.consultationCount}/3
                        </p>
                      </div>
                    </td>
                    <td className="p-6">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => {
                            setEnrollingWaitlist(entry);
                            setEnrollData({
                              name: entry.name,
                              phone: entry.phone,
                              classIds: entry.desiredClassId ? [entry.desiredClassId] : [],
                              status: 'Study'
                            });
                          }}
                          className="px-3 py-1.5 bg-emerald-600 text-white text-[10px] font-bold uppercase rounded-lg hover:bg-emerald-700 transition-colors"
                        >
                          Enroll
                        </button>
                        <button 
                          onClick={() => {
                            setEditingWaitlist(entry);
                            setIsAddModalOpen(true);
                          }}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                          title="Edit"
                        >
                          <Settings size={14} />
                        </button>
                        <button 
                          onClick={() => handleUpdateConsultation(entry.id, entry.consultationCount)}
                          disabled={entry.consultationCount >= 3}
                          className="p-2 text-amber-600 hover:bg-amber-50 rounded-xl transition-colors disabled:opacity-30"
                          title="Next Consultation Cycle"
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button 
                          onClick={() => handleMarkFailed(entry.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                          title="Mark Failed"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
          <div className="bg-white rounded-[40px] w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-8 border-b border-black/5 flex items-center justify-between">
              <h2 className="text-2xl font-serif italic">{editingWaitlist ? 'Edit Potential Student' : 'Add Potential Student'}</h2>
              <button onClick={() => { setIsAddModalOpen(false); setEditingWaitlist(null); }} className="p-2 hover:bg-black/5 rounded-full">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSaveWaitlist} className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-black/40">Full Name</label>
                  <input name="name" required defaultValue={editingWaitlist?.name} className="w-full bg-black/[0.02] border-none rounded-2xl p-4 text-sm" placeholder="Student Name" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-black/40">Phone Number</label>
                  <input name="phone" required defaultValue={editingWaitlist?.phone} className="w-full bg-black/[0.02] border-none rounded-2xl p-4 text-sm" placeholder="090..." />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-black/40">Source</label>
                  <select name="source" required defaultValue={editingWaitlist?.source || 'Direct'} className="w-full bg-black/[0.02] border-none rounded-2xl p-4 text-sm">
                    <option value="Direct">Direct</option>
                    <option value="Zalo">Zalo</option>
                    <option value="Facebook">Facebook</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-black/40">Consultant (Mandatory)</label>
                  <select name="consultantId" required defaultValue={editingWaitlist?.consultantId} className="w-full bg-black/[0.02] border-none rounded-2xl p-4 text-sm">
                    <option value="">Select Consultant</option>
                    {consultants.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-black/40">Desired Class (Optional)</label>
                  <select name="desiredClassId" defaultValue={editingWaitlist?.desiredClassId || ''} className="w-full bg-black/[0.02] border-none rounded-2xl p-4 text-sm">
                    <option value="">Select Class</option>
                    {classes.filter(c => c.status === 'Active').map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-black/40">Referrer (Optional)</label>
                  <select name="referrerStaffId" defaultValue={editingWaitlist?.referrerStaffId || ''} className="w-full bg-black/[0.02] border-none rounded-2xl p-4 text-sm">
                    <option value="">None</option>
                    {staff.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-black/40">Notes</label>
                <textarea 
                  name="notes"
                  defaultValue={editingWaitlist?.notes}
                  className="w-full bg-black/[0.02] border-none rounded-2xl p-4 text-sm min-h-[100px]"
                  placeholder="Additional information..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <Button type="button" onClick={() => { setIsAddModalOpen(false); setEditingWaitlist(null); }} className="flex-1 bg-black/5 hover:bg-black/10">Cancel</Button>
                <Button type="submit" className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700">
                  {editingWaitlist ? 'Update Student' : 'Save Student'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Enroll Modal */}
      {enrollingWaitlist && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-[40px] shadow-2xl border border-black/5 w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-8 border-b border-black/5 bg-gray-50/50 flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold">Enroll Student</h2>
                <p className="text-sm text-black/40">Converting waitlist entry to student record</p>
              </div>
              <button onClick={() => setEnrollingWaitlist(null)} className="p-2 hover:bg-black/5 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleEnrollSubmit}>
              <div className="p-8 space-y-6 max-h-[70vh] overflow-auto">
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h3 className="text-xs uppercase tracking-widest font-bold text-emerald-600 border-b border-emerald-100 pb-2">Basic Info</h3>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Full Name</label>
                      <Input value={enrollData.name || ''} onChange={e => setEnrollData({...enrollData, name: e.target.value})} required />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Nickname</label>
                        <Input value={enrollData.nickname || ''} onChange={e => setEnrollData({...enrollData, nickname: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Status</label>
                        <Select value={enrollData.status || 'Study'} onChange={e => setEnrollData({...enrollData, status: e.target.value as any})}>
                          <option value="Study">Study</option>
                          <option value="Trial">Trial</option>
                          <option value="Pending">Pending</option>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Gender</label>
                        <Select value={enrollData.gender || 'Male'} onChange={e => setEnrollData({...enrollData, gender: e.target.value as any})}>
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Other">Other</option>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Birth Year</label>
                        <Input type="number" value={enrollData.birthYear || ''} onChange={e => setEnrollData({...enrollData, birthYear: Number(e.target.value)})} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Phone Number</label>
                      <Input value={enrollData.phone || ''} onChange={e => setEnrollData({...enrollData, phone: e.target.value})} required />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-xs uppercase tracking-widest font-bold text-emerald-600 border-b border-emerald-100 pb-2">Contact & Parent Info</h3>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Email</label>
                      <Input type="email" value={enrollData.email || ''} onChange={e => setEnrollData({...enrollData, email: e.target.value})} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Address</label>
                      <Input value={enrollData.school || ''} onChange={e => setEnrollData({...enrollData, school: e.target.value})} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Parent Name</label>
                        <Input value={enrollData.parentName || ''} onChange={e => setEnrollData({...enrollData, parentName: e.target.value})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Parent Phone</label>
                        <Input value={enrollData.parentPhone || ''} onChange={e => setEnrollData({...enrollData, parentPhone: e.target.value})} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Note</label>
                      <textarea 
                        value={enrollData.note || ''} 
                        onChange={e => setEnrollData({...enrollData, note: e.target.value})}
                        className="w-full px-4 py-2 bg-white border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 min-h-[80px]"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-black/5">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs uppercase tracking-widest font-bold text-emerald-600">Enrolled Classes</h3>
                    <div className="w-64">
                      <Select 
                        value="" 
                        onChange={e => {
                          const classId = e.target.value;
                          if (!classId) return;
                          const current = enrollData.classIds || [];
                          if (!current.includes(classId)) {
                            setEnrollData({...enrollData, classIds: [...current, classId]});
                          }
                          e.target.value = "";
                        }}
                      >
                        <option value="">Add to class...</option>
                        {classes.filter(c => c.status === 'Active' && !enrollData.classIds?.includes(c.id))
                          .map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                        }
                      </Select>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {enrollData.classIds?.map(id => {
                      const cls = classes.find(c => c.id === id);
                      return (
                        <div key={id} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl border border-emerald-100 text-xs font-bold">
                          {cls?.name}
                          <button type="button" onClick={() => setEnrollData({...enrollData, classIds: enrollData.classIds?.filter(cid => cid !== id)})}>
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="p-8 border-t border-black/5 flex gap-3">
                <Button type="button" onClick={() => setEnrollingWaitlist(null)} className="flex-1 bg-black/5 hover:bg-black/10">Cancel</Button>
                <Button type="submit" className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-500/20">Complete Enrollment</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// --- View: Report ---

function ReportView({ 
  subTab, 
  students, 
  classes, 
  tuitionRecords, 
  attendanceRecords,
  staff,
  departments
}: { 
  subTab: 'overview' | 'students' | 'revenue',
  students: Student[],
  classes: Class[],
  tuitionRecords: TuitionRecord[],
  attendanceRecords: AttendanceRecord[],
  staff: Staff[],
  departments: Department[]
}) {
  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  // Data for Overview: Student Status
  const studentStatusData = useMemo(() => {
    const counts = students.reduce((acc, s) => {
      acc[s.status] = (acc[s.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [students]);

  // Data for Revenue: Monthly
  const revenueData = useMemo(() => {
    const last6Months = Array.from({ length: 6 }, (_, i) => {
      const d = subMonthsDateFns(new Date(), i);
      return format(d, 'yyyy-MM');
    }).reverse();

    return last6Months.map(month => {
      const total = tuitionRecords
        .filter(r => r.month === month && typeof r.amount === 'number')
        .reduce((sum, r) => sum + (r.amount as number), 0);
      return { month, amount: total };
    });
  }, [tuitionRecords]);

  // Data for Attendance: By Class
  const attendanceData = useMemo(() => {
    return classes
      .filter(c => c.status === 'Active')
      .map(c => {
        const records = attendanceRecords.filter(r => r.classId === c.id);
        if (records.length === 0) return { name: c.name, rate: 0 };
        
        let totalPresent = 0;
        let totalPossible = 0;
        
        records.forEach(r => {
          totalPresent += r.students.filter(s => s.status === 'Present').length;
          totalPossible += r.students.length;
        });
        
        return { 
          name: c.name, 
          rate: totalPossible > 0 ? Math.round((totalPresent / totalPossible) * 100) : 0 
        };
      })
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10); // Top 10 classes
  }, [classes, attendanceRecords]);

  return (
    <div className="space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif italic pl-12 capitalize">Reports: {subTab}</h1>
      </div>

      {subTab === 'overview' && (
        <div className="space-y-8">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm">
              <p className="text-[10px] uppercase font-bold text-black/40 mb-1">Total Students</p>
              <p className="text-3xl font-serif italic">{students.length}</p>
              <p className="text-xs text-emerald-600 mt-2 font-medium">
                {students.filter(s => s.status === 'Study').length} Active
              </p>
            </div>
            <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm">
              <p className="text-[10px] uppercase font-bold text-black/40 mb-1">Active Classes</p>
              <p className="text-3xl font-serif italic">{classes.filter(c => c.status === 'Active').length}</p>
              <p className="text-xs text-black/40 mt-2 font-medium">
                Across {new Set(classes.map(c => c.programId)).size} Programs
              </p>
            </div>
            <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm">
              <p className="text-[10px] uppercase font-bold text-black/40 mb-1">Revenue (This Month)</p>
              <p className="text-3xl font-serif italic">
                {revenueData[revenueData.length - 1]?.amount.toLocaleString()}
              </p>
              <p className="text-xs text-black/40 mt-2 font-medium">VND</p>
            </div>
            <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm">
              <p className="text-[10px] uppercase font-bold text-black/40 mb-1">Total Staff</p>
              <p className="text-3xl font-serif italic">{staff.filter(s => s.status === 'Working').length}</p>
              <p className="text-xs text-black/40 mt-2 font-medium">Active Members</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Revenue Chart */}
            <div className="bg-white p-8 rounded-[40px] border border-black/5 shadow-sm h-[400px] flex flex-col">
              <h3 className="text-lg font-bold mb-6">Revenue Trend (Last 6 Months)</h3>
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueData}>
                    <defs>
                      <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#00000005" />
                    <XAxis 
                      dataKey="month" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fontSize: 10, fill: '#00000040'}} 
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{fontSize: 10, fill: '#00000040'}}
                      tickFormatter={(value) => `${(value / 1000000).toFixed(1)}M`}
                    />
                    <Tooltip 
                      contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                      formatter={(value: number) => [value.toLocaleString() + ' VND', 'Revenue']}
                    />
                    <Area type="monotone" dataKey="amount" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorAmount)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Student Status Chart */}
            <div className="bg-white p-8 rounded-[40px] border border-black/5 shadow-sm h-[400px] flex flex-col">
              <h3 className="text-lg font-bold mb-6">Student Status Distribution</h3>
              <div className="flex-1 flex items-center">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie
                      data={studentStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={80}
                      outerRadius={120}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {studentStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                    />
                    <Legend verticalAlign="bottom" height={36}/>
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Attendance Rate Chart */}
          <div className="bg-white p-8 rounded-[40px] border border-black/5 shadow-sm h-[400px] flex flex-col">
            <h3 className="text-lg font-bold mb-6">Top 10 Classes by Attendance Rate (%)</h3>
            <div className="flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <ReBarChart data={attendanceData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#00000005" />
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fontSize: 10, fill: '#00000080', fontWeight: 'bold'}}
                    width={150}
                  />
                  <Tooltip 
                    contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                    formatter={(value: number) => [value + '%', 'Attendance Rate']}
                  />
                  <Bar dataKey="rate" fill="#3b82f6" radius={[0, 10, 10, 0]} barSize={20} />
                </ReBarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {subTab === 'students' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
             {/* Detailed Student Status */}
             <div className="bg-white p-8 rounded-[40px] border border-black/5 shadow-sm">
                <h3 className="text-lg font-bold mb-6">Student Status Summary</h3>
                <div className="space-y-4">
                  {studentStatusData.map((item, idx) => (
                    <div key={item.name} className="flex items-center justify-between p-4 bg-black/[0.02] rounded-2xl">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full" style={{backgroundColor: COLORS[idx % COLORS.length]}}></div>
                        <span className="font-bold text-sm uppercase tracking-wider">{item.name}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-2xl font-serif italic">{item.value}</span>
                        <span className="text-xs text-black/40 font-medium">
                          ({Math.round((item.value / students.length) * 100)}%)
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
             </div>

             {/* Growth / Enrollment (Mocked trend based on ID order or similar if no date) */}
             <div className="bg-white p-8 rounded-[40px] border border-black/5 shadow-sm flex flex-col">
                <h3 className="text-lg font-bold mb-6">Enrollment Overview</h3>
                <div className="flex-1 flex flex-col justify-center items-center text-center space-y-4">
                  <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center">
                    <Users size={32} className="text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-4xl font-serif italic">{students.filter(s => s.status === 'Study').length}</p>
                    <p className="text-sm text-black/40 font-medium uppercase tracking-widest">Active Students Currently Studying</p>
                  </div>
                  <div className="w-full h-px bg-black/5 my-4"></div>
                  <div className="grid grid-cols-2 w-full gap-4">
                    <div className="p-4 bg-blue-50 rounded-2xl">
                      <p className="text-2xl font-serif italic text-blue-700">{students.filter(s => s.status === 'Trial').length}</p>
                      <p className="text-[10px] font-bold text-blue-600/60 uppercase">Trialing</p>
                    </div>
                    <div className="p-4 bg-amber-50 rounded-2xl">
                      <p className="text-2xl font-serif italic text-amber-700">{students.filter(s => s.status === 'Pending').length}</p>
                      <p className="text-[10px] font-bold text-amber-600/60 uppercase">Pending</p>
                    </div>
                  </div>
                </div>
             </div>
          </div>
        </div>
      )}

      {subTab === 'revenue' && (
        <div className="space-y-8">
          <div className="bg-white p-8 rounded-[40px] border border-black/5 shadow-sm overflow-hidden">
            <h3 className="text-lg font-bold mb-6">Monthly Revenue Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-black/5">
                    <th className="p-4 text-[10px] uppercase font-bold text-black/40">Month</th>
                    <th className="p-4 text-[10px] uppercase font-bold text-black/40">Total Amount (VND)</th>
                    <th className="p-4 text-[10px] uppercase font-bold text-black/40">Transactions</th>
                    <th className="p-4 text-[10px] uppercase font-bold text-black/40">Avg per Student</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.02]">
                  {revenueData.slice().reverse().map(item => {
                    const count = tuitionRecords.filter(r => r.month === item.month && typeof r.amount === 'number').length;
                    return (
                      <tr key={item.month} className="hover:bg-black/[0.01] transition-colors">
                        <td className="p-4 font-bold text-sm">{item.month}</td>
                        <td className="p-4 font-mono text-sm text-emerald-600 font-bold">{item.amount.toLocaleString()}</td>
                        <td className="p-4 text-sm text-black/60">{count}</td>
                        <td className="p-4 text-sm text-black/60">
                          {count > 0 ? Math.round(item.amount / count).toLocaleString() : 0}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="h-[60vh] flex flex-col items-center justify-center text-center p-12">
      <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center mb-4">
        <LayoutDashboard size={32} className="text-black/20" />
      </div>
      <p className="text-black/40 font-serif italic">{message}</p>
    </div>
  );
}

