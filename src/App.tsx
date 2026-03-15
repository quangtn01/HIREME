/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
import { Campus, Staff, Class, Session } from './types';
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
  Copy,
  LogOut,
  UserCircle
} from 'lucide-react';
import { format, startOfWeek, addDays, parseISO, isSameDay, addWeeks, subWeeks, addMinutes } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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
        <Input type="date" value={dateStr} onChange={e => update(e.target.value, startHour, startMinute, endHour, endMinute)} />
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'dashboard2' | 'scheduler' | 'staff' | 'settings'>('dashboard');
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [classes, setClasses] = useState<Class[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Partial<Session> | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;

    const unsubCampuses = onSnapshot(collection(db, 'campuses'), (snap) => {
      setCampuses(snap.docs.map(d => ({ id: d.id, ...d.data() } as Campus)));
    });
    const unsubStaff = onSnapshot(collection(db, 'staff'), (snap) => {
      setStaff(snap.docs.map(d => ({ id: d.id, ...d.data() } as Staff)));
    });
    const unsubClasses = onSnapshot(collection(db, 'classes'), (snap) => {
      setClasses(snap.docs.map(d => ({ id: d.id, ...d.data() } as Class)));
    });
    const unsubSessions = onSnapshot(collection(db, 'sessions'), (snap) => {
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Session)));
    });

    return () => {
      unsubCampuses();
      unsubStaff();
      unsubClasses();
      unsubSessions();
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
          <Button onClick={handleLogin} className="w-full bg-emerald-600 text-white hover:bg-emerald-700 py-4 flex items-center justify-center gap-2">
            <UserCircle size={20} />
            Sign in with Google
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-black/5 flex flex-col">
        <div className="p-6 border-bottom border-black/5">
          <h2 className="text-xl font-serif italic">Hireme Center</h2>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <NavItem icon={<LayoutDashboard size={18} />} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <NavItem icon={<Grid size={18} />} label="Office View" active={activeTab === 'dashboard2'} onClick={() => setActiveTab('dashboard2')} />
          <NavItem icon={<Users size={18} />} label="Staff View" active={activeTab === 'staff'} onClick={() => setActiveTab('staff')} />
          <NavItem icon={<Calendar size={18} />} label="Scheduler" active={activeTab === 'scheduler'} onClick={() => setActiveTab('scheduler')} />
          <NavItem icon={<Settings size={18} />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
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
      <main className="flex-1 overflow-auto p-4">
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
        {activeTab === 'scheduler' && (
          <SchedulerView 
            campuses={campuses} 
            staff={staff} 
            classes={classes} 
            sessions={sessions} 
            isModalOpen={isModalOpen}
            setIsModalOpen={setIsModalOpen}
            editingSession={editingSession}
            setEditingSession={setEditingSession}
          />
        )}
        {activeTab === 'staff' && (
          <StaffView 
            staff={staff} 
            sessions={sessions} 
            classes={classes} 
            campuses={campuses} 
            onAddSession={(data) => {
              setEditingSession(data);
              setIsModalOpen(true);
            }}
          />
        )}
        {activeTab === 'settings' && <SettingsView campuses={campuses} staff={staff} classes={classes} />}
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
        />
      )}
    </div>
  );
}

function SessionModal({ isOpen, onClose, editingSession, setEditingSession, campuses, staff, classes }: { 
  isOpen: boolean, 
  onClose: () => void, 
  editingSession: Partial<Session> | null, 
  setEditingSession: (s: Partial<Session> | null) => void,
  campuses: Campus[],
  staff: Staff[],
  classes: Class[]
}) {
  const activeClasses = classes
    .filter(c => c.status === 'Active')
    .sort((a, b) => a.name.localeCompare(b.name));

  const sortedCampuses = [...campuses].sort((a, b) => a.name.localeCompare(b.name));
  const sortedTeachers = staff
    .filter(s => s.role === 'Teacher')
    .sort((a, b) => a.name.localeCompare(b.name));
  const sortedTAs = staff
    .filter(s => s.role === 'TA')
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSession || !editingSession.startTime) return;

    const weekStart = format(startOfWeek(parseISO(editingSession.startTime), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const data = {
      ...editingSession,
      weekStart,
    } as any;

    if (editingSession.id) {
      await updateDoc(doc(db, 'sessions', editingSession.id), data);
    } else {
      await addDoc(collection(db, 'sessions'), data);
    }
    onClose();
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
                {sortedTeachers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-bold text-black/40 ml-1">TA (Optional)</label>
              <Select value={editingSession?.taId || ''} onChange={e => setEditingSession({...editingSession, taId: e.target.value})}>
                <option value="">Select TA</option>
                {sortedTAs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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

          <div className="flex gap-3 pt-4">
            <Button type="button" onClick={onClose} className="flex-1 bg-black/5 hover:bg-black/10">Cancel</Button>
            <Button type="submit" className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700">Save Session</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
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
  const [selectedCampusId, setSelectedCampusId] = useState<string>(campuses[0]?.id || '');
  const [currentWeek, setCurrentWeek] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const campus = campuses.find(c => c.id === selectedCampusId);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i));

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

  if (!campuses.length) return <EmptyState message="No campuses found. Please add one in Settings." />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif italic">Campus Dashboard</h1>
        <div className="flex items-center gap-4">
          <Button 
            onClick={() => onAddSession({})}
            className="bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-2"
          >
            <Plus size={18} />
            New Session
          </Button>
          <div className="flex items-center bg-white rounded-xl border border-black/5 p-1">
            <button onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} className="p-2 hover:bg-black/5 rounded-lg"><ChevronLeft size={16} /></button>
            <span className="px-4 text-sm font-medium">Week of {format(currentWeek, 'MMM d, yyyy')}</span>
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
                      <p className="text-[10px] text-black/40">{format(day, 'MMM d')}</p>
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
                          const session = sessions.find(s => 
                            s.campusId === campus.id && 
                            s.room === room && 
                            isSameDay(parseISO(s.startTime), day) &&
                            format(parseISO(s.startTime), 'HH:mm') === slot.start
                          );

                          return (
                            <td 
                              key={day.toISOString()} 
                              className="p-1 border-r border-b border-black/5 align-middle h-16 cursor-pointer hover:bg-black/[0.02] transition-colors"
                              onDoubleClick={() => session ? onAddSession(session) : handleDoubleClick(day, slot, room)}
                            >
                              {session ? (
                                <div className="p-2 bg-emerald-50 border border-emerald-100 rounded-xl h-full flex flex-col justify-center overflow-hidden">
                                  <p className="font-bold text-emerald-900 leading-tight mb-0.5 text-xs">
                                    {classes.find(c => c.id === session.classId)?.name}
                                  </p>
                                  <p className="text-[10px] text-emerald-700/70 font-medium truncate">
                                    GV: {staff.find(st => st.id === session.teacherId)?.name}
                                  </p>
                                  {session.taId && (
                                    <p className="text-[9px] text-emerald-600/60 truncate">
                                      TA: {staff.find(st => st.id === session.taId)?.name}
                                    </p>
                                  )}
                                  {session.notes && (
                                    <p className="text-[8px] text-emerald-600 italic truncate mt-0.5 border-t border-emerald-200/50 pt-0.5">
                                      {session.notes}
                                    </p>
                                  )}
                                  {session.zoomId && <p className="text-[8px] text-emerald-500 font-mono truncate mt-0.5">Z: {session.zoomId}</p>}
                                </div>
                              ) : (
                                <div className="h-full w-full opacity-10" />
                              )}
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
  const [selectedCampusId, setSelectedCampusId] = useState<string>(campuses[0]?.id || '');
  const [currentWeek, setCurrentWeek] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));

  const campus = campuses.find(c => c.id === selectedCampusId);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i));

  if (!campuses.length) return <EmptyState message="No campuses found. Please add one in Settings." />;

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
        <h1 className="text-3xl font-serif italic">Office View</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-white rounded-xl border border-black/5 p-1">
            <button onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} className="p-2 hover:bg-black/5 rounded-lg"><ChevronLeft size={16} /></button>
            <span className="px-4 text-sm font-medium">Week of {format(currentWeek, 'MMM d, yyyy')}</span>
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
                    <p className="text-[10px] text-black/40">{format(day, 'MMM d')}</p>
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
                      format(parseISO(s.startTime), 'HH:mm') === slot.start
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
                              className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl cursor-pointer hover:bg-emerald-50 transition-all hover:shadow-sm"
                            >
                              <p className="font-bold text-emerald-900 text-xs mb-1.5 uppercase tracking-tight">
                                {classes.find(c => c.id === session.classId)?.name}
                              </p>
                              <div className="space-y-1">
                                <div className="flex items-center gap-1.5 text-[10px] text-emerald-700/70 font-medium">
                                  <span className="w-3.5 h-3.5 flex items-center justify-center bg-emerald-100 rounded text-[8px]">🏢</span>
                                  <span>Phòng {session.room}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] text-emerald-600/60">
                                  <span className="w-3.5 h-3.5 flex items-center justify-center bg-emerald-100 rounded text-[8px]">👤</span>
                                  <span className="truncate">{staff.find(st => st.id === session.teacherId)?.name}</span>
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

    await batch.commit();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif italic">Admin Scheduler</h1>
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
          <span className="px-4 text-sm font-medium">Week of {format(currentWeek, 'MMM d, yyyy')}</span>
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
                <button onClick={() => deleteDoc(doc(db, 'sessions', s.id))} className="p-2 hover:bg-red-50 rounded-lg text-red-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-black/30 mb-2">{s.room}</p>
              <h3 className="font-bold text-lg mb-1">{classes.find(c => c.id === s.classId)?.name || 'Unknown Class'}</h3>
              <p className="text-sm text-black/60 mb-4">
                {format(parseISO(s.startTime), 'EEEE, HH:mm')} - {format(parseISO(s.endTime), 'HH:mm')}
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-[10px] font-medium">GV: {staff.find(st => st.id === s.teacherId)?.name}</span>
                {s.taId && <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-medium">TA: {staff.find(st => st.id === s.taId)?.name}</span>}
                {s.zoomId && <span className="px-2 py-1 bg-black/5 text-black/60 rounded-lg text-[10px] font-mono">Zoom: {s.zoomId}</span>}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// --- View: Staff View ---

function StaffView({ staff, sessions, classes, campuses, onAddSession }: { 
  staff: Staff[], 
  sessions: Session[], 
  classes: Class[], 
  campuses: Campus[],
  onAddSession: (data: Partial<Session>) => void
}) {
  const [currentWeek, setCurrentWeek] = useState(startOfWeek(new Date(), { weekStartsOn: 1 }));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(currentWeek, i));

  const handleDoubleClick = (day: Date, slot: typeof SLOTS[0], memberId: string) => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const startTime = new Date(`${dateStr}T${slot.start}:00`).toISOString();
    
    // Calculate end time (90 mins later)
    const end = addMinutes(parseISO(startTime), 90);
    const endTime = end.toISOString();

    onAddSession({
      teacherId: memberId,
      startTime,
      endTime
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-serif italic">Staff Schedule</h1>
        <div className="flex items-center bg-white rounded-xl border border-black/5 p-1">
          <button onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} className="p-2 hover:bg-black/5 rounded-lg"><ChevronLeft size={16} /></button>
          <span className="px-4 text-sm font-medium">Week of {format(currentWeek, 'MMM d, yyyy')}</span>
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
                    <p className="text-[10px] text-black/40">{format(day, 'MMM d')}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.sort((a, b) => a.name.localeCompare(b.name)).map(member => (
                <React.Fragment key={member.id}>
                  {SLOTS.map((slot, slotIdx) => (
                    <tr key={`${member.id}-${slot.id}`}>
                      {slotIdx === 0 && (
                        <td rowSpan={4} className="sticky left-0 z-10 p-4 border-r border-b border-black/5 bg-[#fafafa] align-middle w-[150px] min-w-[150px] max-w-[150px]">
                          <p className="font-bold text-sm">{member.name}</p>
                          <p className="text-[10px] text-black/40 uppercase tracking-widest">{member.role}</p>
                        </td>
                      )}
                      <td className="sticky left-[150px] z-10 p-2 border-r border-b border-black/5 text-[10px] font-mono text-black/40 bg-[#fcfcfc] whitespace-nowrap align-middle w-[100px] min-w-[100px] max-w-[100px]">
                        {slot.label}
                      </td>
                      {weekDays.map(day => {
                        const session = sessions.find(s => 
                          (s.teacherId === member.id || s.taId === member.id) && 
                          isSameDay(parseISO(s.startTime), day) &&
                          format(parseISO(s.startTime), 'HH:mm') === slot.start
                        );

                        return (
                          <td 
                            key={day.toISOString()} 
                            className="p-1 border-r border-b border-black/5 align-middle h-16 transition-colors"
                          >
                            {session ? (
                              <div className="p-2 bg-emerald-50 border border-emerald-100 rounded-xl h-full flex flex-col justify-center overflow-hidden">
                                <p className="font-bold text-emerald-900 leading-tight mb-0.5 text-xs">
                                  {classes.find(c => c.id === session.classId)?.name}
                                </p>
                                <p className="text-[10px] text-emerald-700/70 font-medium truncate">
                                  {campuses.find(c => c.id === session.campusId)?.name} - {session.room}
                                </p>
                                {session.notes && (
                                  <p className="text-[8px] text-emerald-600 italic truncate mt-0.5 border-t border-emerald-200/50 pt-0.5">
                                    {session.notes}
                                  </p>
                                )}
                              </div>
                            ) : (
                              <div className="h-full w-full opacity-10" />
                            )}
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

// --- View: Settings (Category Management) ---

function SettingsView({ campuses, staff, classes }: { campuses: Campus[], staff: Staff[], classes: Class[] }) {
  const [newCampus, setNewCampus] = useState<{ id?: string, name: string, rooms: string }>({ name: '', rooms: '' });
  const [newStaff, setNewStaff] = useState<{ id?: string, name: string, role: 'Teacher' | 'TA' }>({ name: '', role: 'Teacher' });
  const [newClass, setNewClass] = useState<{ id?: string, name: string }>({ name: '' });

  const saveCampus = async () => {
    if (!newCampus.name || !newCampus.rooms) return;
    const data = {
      name: newCampus.name,
      rooms: newCampus.rooms.split(',').map(r => r.trim()).filter(r => r)
    };
    if (newCampus.id) {
      await updateDoc(doc(db, 'campuses', newCampus.id), data);
    } else {
      await addDoc(collection(db, 'campuses'), data);
    }
    setNewCampus({ name: '', rooms: '' });
  };

  const saveStaff = async () => {
    if (!newStaff.name) return;
    const data = { name: newStaff.name, role: newStaff.role };
    if (newStaff.id) {
      await updateDoc(doc(db, 'staff', newStaff.id), data);
    } else {
      await addDoc(collection(db, 'staff'), data);
    }
    setNewStaff({ name: '', role: 'Teacher' });
  };

  const saveClass = async () => {
    if (!newClass.name) return;
    const data = { name: newClass.name };
    if (newClass.id) {
      await updateDoc(doc(db, 'classes', newClass.id), data);
    } else {
      await addDoc(collection(db, 'classes'), { ...data, status: 'Active' });
    }
    setNewClass({ name: '' });
  };

  const toggleClassStatus = async (cls: Class) => {
    await updateDoc(doc(db, 'classes', cls.id), {
      status: cls.status === 'Active' ? 'Archived' : 'Active'
    });
  };

  return (
    <div className="max-w-4xl space-y-12">
      <h1 className="text-3xl font-serif italic">Category Management</h1>

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
                  <p className="text-xs text-black/40">Rooms: {c.rooms.join(', ')}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setNewCampus({ id: c.id, name: c.name, rooms: c.rooms.join(', ') })} className="text-emerald-600 hover:text-emerald-700 p-1"><Settings size={16} /></button>
                  <button onClick={() => deleteDoc(doc(db, 'campuses', c.id))} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Staff */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Users size={20} className="text-blue-600" />
          Staff Directory
        </h2>
        <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm space-y-6">
          <div className="flex gap-4">
            <Input placeholder="Full Name" value={newStaff.name} onChange={e => setNewStaff({...newStaff, name: e.target.value})} />
            <Select value={newStaff.role} onChange={e => setNewStaff({...newStaff, role: e.target.value as any})}>
              <option value="Teacher">Teacher</option>
              <option value="TA">TA</option>
            </Select>
            <Button onClick={saveStaff} className="bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap">
              {newStaff.id ? 'Update' : 'Add Staff'}
            </Button>
            {newStaff.id && <Button onClick={() => setNewStaff({ name: '', role: 'Teacher' })} className="bg-black/5 hover:bg-black/10">Cancel</Button>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[...staff].sort((a, b) => a.name.localeCompare(b.name)).map(s => (
              <div key={s.id} className="p-4 bg-black/5 rounded-2xl flex justify-between items-center">
                <div>
                  <p className="font-bold text-sm">{s.name}</p>
                  <p className="text-[10px] text-black/40 uppercase tracking-widest">{s.role}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setNewStaff({ id: s.id, name: s.name, role: s.role })} className="text-emerald-600 hover:text-emerald-700 p-1"><Settings size={16} /></button>
                  <button onClick={() => deleteDoc(doc(db, 'staff', s.id))} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Classes */}
      <section className="space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Calendar size={20} className="text-purple-600" />
          Class Management
        </h2>
        <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm space-y-6">
          <div className="flex gap-4">
            <Input placeholder="Class Name (e.g. IELTS 6.5)" value={newClass.name} onChange={e => setNewClass({...newClass, name: e.target.value})} />
            <Button onClick={saveClass} className="bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap">
              {newClass.id ? 'Update' : 'Add Class'}
            </Button>
            {newClass.id && <Button onClick={() => setNewClass({ name: '' })} className="bg-black/5 hover:bg-black/10">Cancel</Button>}
          </div>
          <div className="space-y-2">
            {[...classes].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
              <div key={c.id} className={cn("p-4 rounded-2xl flex justify-between items-center", c.status === 'Active' ? 'bg-black/5' : 'bg-black/[0.02] opacity-50')}>
                <div>
                  <p className="font-bold text-sm">{c.name}</p>
                  <p className="text-[10px] text-black/40 uppercase tracking-widest">{c.status}</p>
                </div>
                <div className="flex gap-4 items-center">
                  <button onClick={() => toggleClassStatus(c)} className="text-xs font-medium text-emerald-600 hover:underline">
                    {c.status === 'Active' ? 'Archive' : 'Restore'}
                  </button>
                  <button onClick={() => setNewClass({ id: c.id, name: c.name })} className="text-emerald-600 hover:text-emerald-700 p-1"><Settings size={16} /></button>
                  <button onClick={() => deleteDoc(doc(db, 'classes', c.id))} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="h-[60vh] flex flex-col items-center justify-center text-center p-12">
      <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center mb-4">
        <Settings size={32} className="text-black/20" />
      </div>
      <p className="text-black/40 font-serif italic">{message}</p>
    </div>
  );
}

