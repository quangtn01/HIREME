import React, { useState, useCallback, useRef } from 'react';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  writeBatch 
} from 'firebase/firestore';
import { db } from './firebase';
import * as XLSX from 'xlsx';
import { Student, Class } from './types';
import { normalizeImportDate, getValue } from './App';
import { 
  Plus, 
  Trash2, 
  Download, 
  Upload, 
  Check, 
  X, 
  Search,
  Calendar,
  GraduationCap,
  BookOpen
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const Button = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button className={cn("px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50", className)} {...props} />
);

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn("w-full px-4 py-2 bg-white border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20", className)} {...props} />
);

const Select = ({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn("w-full px-4 py-2 bg-white border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20", className)} {...props} />
);

export function StudentView({ subTab, students, classes }: { 
  subTab: 'details' | 'summary' | 'byClass',
  students: Student[], 
  classes: Class[] 
}) {
  const [editingStudent, setEditingStudent] = useState<Partial<Student> | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDone, setShowDone] = useState(false); // Done students
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [summaryFilter, setSummaryFilter] = useState<'Study' | 'Trial' | 'Pending' | 'Done' | 'All'>('All');

  const generateNextStudentId = () => {
    const ids = students.map(s => s.studentId).filter(id => id && id.startsWith('HV'));
    if (ids.length === 0) return 'HV000001';
    const maxId = Math.max(...ids.map(id => parseInt(id.replace('HV', ''))));
    return `HV${(maxId + 1).toString().padStart(6, '0')}`;
  };

  const exportToExcel = () => {
    const dataToExport = students
      .filter(s => showDone || s.status !== 'Done')
      .map(s => ({
        'ID (System)': s.id,
        'Student ID': s.studentId,
        'Full Name': s.name,
        'Nickname': s.nickname || '',
        'Status': s.status,
        'Gender': s.gender || '',
        'Birth Year': s.birthYear || '',
        'Phone': s.phone || '',
        'Classes': s.classIds.map(id => classes.find(c => c.id === id)?.name).join(', '),
        'Email': s.email || '',
        'Số CCCD': s.facebook || '',
        'Địa chỉ': s.school || '',
        'Parent Name': s.parentName || '',
        'Parent Phone': s.parentPhone || '',
        'Note': s.note || ''
      }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    XLSX.writeFile(wb, "Student_Data.xlsx");
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
        const birthYearVal = getValue(row, ['Birth Year', 'Năm sinh', 'Ngày sinh']);
        const normalizedBirthDate = normalizeImportDate(birthYearVal);
        const birthYear = normalizedBirthDate ? parseInt(normalizedBirthDate.substring(0, 4)) : 0;

        const studentData: any = {
          studentId: getValue(row, ['Student ID', 'Mã học viên']) || '',
          name: getValue(row, ['Full Name', 'Họ và tên']) || '',
          nickname: getValue(row, ['Nickname', 'Tên gọi khác']) || '',
          status: getValue(row, ['Status', 'Trạng thái']) || 'Pending',
          gender: getValue(row, ['Gender', 'Giới tính']) || 'Male',
          birthYear: birthYear || Number(birthYearVal) || 0,
          phone: getValue(row, ['Phone', 'Số điện thoại']) || '',
          classIds: getValue(row, ['Classes', 'Lớp học']) ? String(getValue(row, ['Classes', 'Lớp học'])).split(',').map((n: string) => classes.find(c => c.name === n.trim())?.id).filter((id: any) => id) : [],
          email: getValue(row, ['Email']) || '',
          facebook: getValue(row, ['Số CCCD', 'Facebook']) || '',
          school: getValue(row, ['Địa chỉ', 'Trường học']) || '',
          parentName: getValue(row, ['Parent Name', 'Tên phụ huynh']) || '',
          parentPhone: getValue(row, ['Parent Phone', 'SĐT phụ huynh']) || '',
          note: getValue(row, ['Note', 'Ghi chú']) || ''
        };

        const systemId = getValue(row, ['ID (System)', 'ID Hệ thống']);
        if (systemId) {
          batch.update(doc(db, 'students', systemId), studentData);
        } else {
          if (studentData.name) {
            const newDoc = doc(collection(db, 'students'));
            batch.set(newDoc, studentData);
          }
        }
      }

      await batch.commit();
      alert("Import complete!");
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  };

  const saveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent?.name) return;

    const classIds = editingStudent.classIds || [];
    let status = editingStudent.status || 'Pending';
    if (classIds.length === 0 && (status === 'Study' || status === 'Trial')) {
      status = 'Pending';
    }

    const data = {
      studentId: editingStudent.studentId || generateNextStudentId(),
      name: editingStudent.name,
      nickname: editingStudent.nickname || '',
      status,
      gender: editingStudent.gender || 'Male',
      birthYear: Number(editingStudent.birthYear) || 0,
      phone: editingStudent.phone || '',
      classIds,
      email: editingStudent.email || '',
      facebook: editingStudent.facebook || '',
      school: editingStudent.school || '',
      parentName: editingStudent.parentName || '',
      parentPhone: editingStudent.parentPhone || '',
      note: editingStudent.note || ''
    };

    if (editingStudent.id) {
      await updateDoc(doc(db, 'students', editingStudent.id), data);
    } else {
      await addDoc(collection(db, 'students'), data);
    }
    setEditingStudent(null);
    setIsFormOpen(false);
  };

  const deleteStudent = async () => {
    if (!editingStudent?.id) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deleteDoc(doc(db, 'students', editingStudent.id));
    setEditingStudent(null);
    setIsFormOpen(false);
    setConfirmDelete(false);
  };

  const filteredStudents = students.filter(s => {
    const matchesSearch = 
      s.studentId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.phone && s.phone.includes(searchQuery));
    const matchesStatus = showDone || s.status !== 'Done';
    return matchesSearch && matchesStatus;
  }).sort((a, b) => a.studentId.localeCompare(b.studentId));

  const activeClasses = classes
    .filter(c => c.status === 'Active')
    .sort((a, b) => a.name.localeCompare(b.name));

  const getSummaryData = () => {
    const counts = {
      Study: students.filter(s => s.status === 'Study').length,
      Trial: students.filter(s => s.status === 'Trial').length,
      Pending: students.filter(s => s.status === 'Pending').length,
      Done: students.filter(s => s.status === 'Done').length,
      All: students.length
    };
    return counts;
  };

  const getStudentsByClass = () => {
    if (!selectedClassId) return [];
    return students
      .filter(s => s.classIds.includes(selectedClassId))
      .sort((a, b) => {
        const order: Record<string, number> = { 'Study': 1, 'Trial': 2, 'Pending': 3, 'Done': 4 };
        return order[a.status] - order[b.status];
      });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-4">
      {subTab === 'details' && (
        <div className="flex gap-6 flex-1 overflow-hidden">
          {/* Left: Student List */}
          <div className="w-1/3 bg-white rounded-[32px] border border-black/5 shadow-sm flex flex-col overflow-hidden">
            <div className="p-6 border-b border-black/5 flex flex-col gap-4 bg-gray-50/50">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <GraduationCap size={20} className="text-emerald-600" />
                  Students
                </h2>
                <Button 
                  onClick={() => { setEditingStudent({ classIds: [], status: 'Pending' }); setIsFormOpen(true); setConfirmDelete(false); }}
                  className="bg-emerald-600 text-white hover:bg-emerald-700 text-xs py-1.5 h-auto"
                >
                  <Plus size={14} className="mr-1" /> Add Student
                </Button>
              </div>
              
              <div className="flex flex-col gap-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/20" />
                  <input 
                    type="text" 
                    placeholder="Search ID, Name, Phone..."
                    className="w-full pl-9 pr-3 py-2 bg-white border border-black/5 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
                
                <div className="flex justify-between items-center">
                  <button 
                    onClick={() => setShowDone(!showDone)}
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wider transition-colors",
                      showDone ? "text-emerald-600" : "text-black/40 hover:text-black/60"
                    )}
                  >
                    {showDone ? "Hide Done" : "Show All"}
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={exportToExcel} className="text-blue-600 hover:text-blue-800 flex items-center gap-1" title="Export to Excel">
                      <Download size={12} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Export</span>
                    </button>
                    <label className="text-emerald-600 hover:text-emerald-800 flex items-center gap-1 cursor-pointer" title="Import from Excel">
                      <Upload size={12} />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Import</span>
                      <input type="file" accept=".xlsx, .xls" className="hidden" onChange={importFromExcel} />
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-2">
              {filteredStudents.map(s => (
                <div 
                  key={s.id} 
                  onClick={() => { setEditingStudent(s); setIsFormOpen(true); setConfirmDelete(false); }}
                  className={cn(
                    "p-3 rounded-xl flex justify-between items-center cursor-pointer transition-all border",
                    editingStudent?.id === s.id ? "bg-emerald-50 border-emerald-200" : "bg-black/[0.02] border-transparent hover:bg-black/[0.05]",
                    s.status === 'Done' && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center font-bold text-[10px] uppercase tracking-tighter",
                      s.status === 'Study' ? "bg-emerald-100 text-emerald-700" :
                      s.status === 'Trial' ? "bg-blue-100 text-blue-700" :
                      s.status === 'Pending' ? "bg-amber-100 text-amber-700" :
                      "bg-gray-100 text-gray-700"
                    )}>
                      {s.status}
                    </div>
                    <div>
                      <p className="font-bold text-sm">{s.name}</p>
                      <p className="text-[10px] text-black/40 font-mono italic">{s.nickname || ''}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-600 font-mono">
                      {s.phone}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Student Form */}
          <div className="w-2/3 bg-white rounded-[32px] border border-black/5 shadow-sm flex flex-col overflow-hidden">
            {isFormOpen ? (
              <form onSubmit={saveStudent} className="flex flex-col h-full">
                <div className="p-6 border-b border-black/5 bg-gray-50/50 flex justify-between items-center">
                  <h2 className="text-xl font-bold">
                    {editingStudent?.id ? `Edit Student: ${editingStudent.studentId}` : 'New Student'}
                  </h2>
                  <button 
                    type="button"
                    onClick={() => { setIsFormOpen(false); setEditingStudent(null); }}
                    className="p-2 hover:bg-black/5 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                
                <div className="flex-1 overflow-auto p-8 space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Basic Information */}
                    <div className="space-y-4">
                      <h3 className="text-xs uppercase tracking-widest font-bold text-emerald-600 border-b border-emerald-100 pb-2">Basic Information</h3>
                      
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Student ID</label>
                        <Input disabled value={editingStudent?.studentId || generateNextStudentId()} className="bg-black/[0.02] font-mono text-blue-600 font-bold" />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Full Name</label>
                          <Input required value={editingStudent?.name || ''} onChange={e => setEditingStudent({...editingStudent, name: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Nickname</label>
                          <Input value={editingStudent?.nickname || ''} onChange={e => setEditingStudent({...editingStudent, nickname: e.target.value})} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Status</label>
                          <Select value={editingStudent?.status || 'Pending'} onChange={e => setEditingStudent({...editingStudent, status: e.target.value as any})}>
                            <option value="Study">Study</option>
                            <option value="Trial">Trial</option>
                            <option value="Pending">Pending</option>
                            <option value="Done">Done</option>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Gender</label>
                          <Select value={editingStudent?.gender || 'Male'} onChange={e => setEditingStudent({...editingStudent, gender: e.target.value as any})}>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Birth Year</label>
                          <Input type="number" value={editingStudent?.birthYear || ''} onChange={e => setEditingStudent({...editingStudent, birthYear: Number(e.target.value)})} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Phone</label>
                          <Input value={editingStudent?.phone || ''} onChange={e => setEditingStudent({...editingStudent, phone: e.target.value})} />
                        </div>
                      </div>
                    </div>

                    {/* Contact & Parent Info */}
                    <div className="space-y-4">
                      <h3 className="text-xs uppercase tracking-widest font-bold text-emerald-600 border-b border-emerald-100 pb-2">Contact & Parent Info</h3>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Email</label>
                          <Input type="email" value={editingStudent?.email || ''} onChange={e => setEditingStudent({...editingStudent, email: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Số CCCD</label>
                          <Input value={editingStudent?.facebook || ''} onChange={e => setEditingStudent({...editingStudent, facebook: e.target.value})} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Địa chỉ</label>
                        <Input value={editingStudent?.school || ''} onChange={e => setEditingStudent({...editingStudent, school: e.target.value})} />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Parent Name</label>
                          <Input value={editingStudent?.parentName || ''} onChange={e => setEditingStudent({...editingStudent, parentName: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Parent Phone</label>
                          <Input value={editingStudent?.parentPhone || ''} onChange={e => setEditingStudent({...editingStudent, parentPhone: e.target.value})} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-bold text-black/40 ml-1">Note</label>
                        <textarea 
                          className="w-full px-4 py-2 bg-white border border-black/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 min-h-[80px]"
                          value={editingStudent?.note || ''} 
                          onChange={e => setEditingStudent({...editingStudent, note: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Classes Section */}
                  <div className="space-y-4 pt-4 border-t border-black/5">
                    <div className="flex justify-between items-center">
                      <h3 className="text-xs uppercase tracking-widest font-bold text-emerald-600">Enrolled Classes</h3>
                      <div className="w-64">
                        <Select 
                          value="" 
                          onChange={e => {
                            const classId = e.target.value;
                            if (!classId) return;
                            const current = editingStudent?.classIds || [];
                            if (!current.includes(classId)) {
                              setEditingStudent({...editingStudent, classIds: [...current, classId]});
                            }
                            e.target.value = "";
                          }}
                        >
                          <option value="">Add to class...</option>
                          {activeClasses
                            .filter(c => !editingStudent?.classIds?.includes(c.id))
                            .map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                          }
                        </Select>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      {editingStudent?.classIds?.map(id => {
                        const cls = classes.find(c => c.id === id);
                        if (!cls) return null;
                        return (
                          <div key={id} className="flex items-center justify-between p-3 bg-black/[0.02] border border-black/5 rounded-xl">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700 font-bold text-xs">
                                {cls.name.substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-bold">{cls.name}</p>
                                <p className="text-[10px] text-black/40 uppercase tracking-wider">{cls.status}</p>
                              </div>
                            </div>
                            <button 
                              type="button"
                              onClick={() => {
                                const next = editingStudent.classIds?.filter(cid => cid !== id) || [];
                                setEditingStudent({...editingStudent, classIds: next});
                              }}
                              className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        );
                      })}
                      {(!editingStudent?.classIds || editingStudent.classIds.length === 0) && (
                        <p className="text-xs text-black/30 italic text-center py-4">Not enrolled in any classes.</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-6 border-t border-black/5 space-y-3">
                  <div className="flex gap-3">
                    <Button type="button" onClick={() => { setIsFormOpen(false); setEditingStudent(null); }} className="flex-1 bg-black/5 hover:bg-black/10">Cancel</Button>
                    <Button type="submit" className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700">Save Student</Button>
                  </div>
                  {editingStudent?.id && (
                    <button 
                      type="button" 
                      onClick={deleteStudent}
                      onMouseLeave={() => setConfirmDelete(false)}
                      className={cn(
                        "w-full py-2 text-xs rounded-xl transition-all flex items-center justify-center gap-2 border",
                        confirmDelete 
                          ? "bg-red-600 text-white border-red-600 font-bold animate-pulse" 
                          : "text-red-400 hover:text-red-600 hover:bg-red-50 border-transparent"
                      )}
                    >
                      <Trash2 size={14} />
                      {confirmDelete ? 'Click again to confirm' : 'Delete Student'}
                    </button>
                  )}
                </div>
              </form>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-black/20 p-12 text-center">
                <div className="w-24 h-24 bg-black/[0.02] rounded-full flex items-center justify-center mb-4">
                  <GraduationCap size={48} />
                </div>
                <h3 className="text-xl font-bold text-black/40">Select a student</h3>
                <p className="text-sm max-w-xs mt-2">Choose someone from the list to view or edit their full profile information.</p>
                <Button 
                  onClick={() => { setEditingStudent({ classIds: [], status: 'Pending' }); setIsFormOpen(true); setConfirmDelete(false); }}
                  className="mt-6 border border-black/10 hover:bg-black/5"
                >
                  <Plus size={16} className="mr-2" /> Add New Student
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {subTab === 'summary' && (
        <div className="flex-1 bg-white rounded-[32px] border border-black/5 shadow-sm p-8 flex flex-col gap-8">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(getSummaryData()).map(([status, count]) => (
              <div 
                key={status}
                onClick={() => setSummaryFilter(status as any)}
                className={cn(
                  "p-6 rounded-[24px] border transition-all cursor-pointer",
                  summaryFilter === status ? "bg-emerald-50 border-emerald-200 shadow-md scale-105" : "bg-black/[0.02] border-transparent hover:bg-black/[0.05]"
                )}
              >
                <p className="text-[10px] uppercase tracking-widest font-bold text-black/40 mb-1">{status}</p>
                <p className="text-3xl font-serif italic">{count}</p>
              </div>
            ))}
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-gray-50 border-b border-black/5">
                <tr>
                  <th className="p-4 text-[10px] uppercase tracking-widest font-bold text-black/40">Student ID</th>
                  <th className="p-4 text-[10px] uppercase tracking-widest font-bold text-black/40">Full Name</th>
                  <th className="p-4 text-[10px] uppercase tracking-widest font-bold text-black/40">Status</th>
                  <th className="p-4 text-[10px] uppercase tracking-widest font-bold text-black/40">Phone</th>
                </tr>
              </thead>
              <tbody>
                {students
                  .filter(s => summaryFilter === 'All' || s.status === summaryFilter)
                  .map(student => (
                  <tr key={student.id} className="border-b border-black/[0.02]">
                    <td className="p-4 font-mono text-xs font-bold text-blue-600">{student.studentId}</td>
                    <td className="p-4 font-bold text-sm">{student.name}</td>
                    <td className="p-4">
                      <span className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        student.status === 'Study' ? "bg-emerald-100 text-emerald-700" :
                        student.status === 'Trial' ? "bg-blue-100 text-blue-700" :
                        student.status === 'Pending' ? "bg-amber-100 text-amber-700" :
                        "bg-gray-100 text-gray-700"
                      )}>
                        {student.status}
                      </span>
                    </td>
                    <td className="p-4 text-sm">{student.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'byClass' && (
        <div className="flex gap-6 flex-1 overflow-hidden">
          {/* Left: Class List */}
          <div className="w-64 bg-white rounded-[32px] border border-black/5 shadow-sm flex flex-col overflow-hidden">
            <div className="p-6 border-b border-black/5 bg-gray-50/50">
              <h2 className="text-sm font-bold uppercase tracking-widest text-black/40 flex items-center gap-2">
                <BookOpen size={14} />
                Active Classes
              </h2>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-1">
              {activeClasses.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedClassId(c.id)}
                  className={cn(
                    "w-full text-left px-4 py-3 rounded-xl text-sm font-bold transition-all border",
                    selectedClassId === c.id 
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm" 
                      : "bg-transparent border-transparent text-black/60 hover:bg-black/5"
                  )}
                >
                  {c.name}
                </button>
              ))}
              {activeClasses.length === 0 && (
                <p className="text-xs text-black/30 italic text-center py-8">No active classes found.</p>
              )}
            </div>
          </div>

          {/* Right: Student List */}
          <div className="flex-1 bg-white rounded-[32px] border border-black/5 shadow-sm overflow-hidden flex flex-col">
            {selectedClassId ? (
              <>
                <div className="p-6 border-b border-black/5 flex flex-col gap-4 bg-gray-50/50">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                      <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700 text-xs">
                        {classes.find(c => c.id === selectedClassId)?.name.substring(0, 2).toUpperCase()}
                      </div>
                      {classes.find(c => c.id === selectedClassId)?.name} 
                      <span className="text-sm font-normal text-black/40">({getStudentsByClass().length} students)</span>
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    {['Study', 'Trial', 'Pending', 'Done'].map(status => {
                      const count = getStudentsByClass().filter(s => s.status === status).length;
                      return (
                        <div key={status} className="flex items-center gap-2">
                          <span className={cn(
                            "w-2 h-2 rounded-full",
                            status === 'Study' ? "bg-emerald-500" :
                            status === 'Trial' ? "bg-blue-500" :
                            status === 'Pending' ? "bg-amber-500" :
                            "bg-gray-400"
                          )} />
                          <span className="text-[10px] uppercase tracking-wider font-bold text-black/60">{status}:</span>
                          <span className="text-xs font-bold">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-gray-50 border-b border-black/5">
                      <tr>
                        <th className="p-4 text-[10px] uppercase tracking-widest font-bold text-black/40">Student ID</th>
                        <th className="p-4 text-[10px] uppercase tracking-widest font-bold text-black/40">Full Name</th>
                        <th className="p-4 text-[10px] uppercase tracking-widest font-bold text-black/40">Status</th>
                        <th className="p-4 text-[10px] uppercase tracking-widest font-bold text-black/40">Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getStudentsByClass().map(student => (
                        <tr key={student.id} className="border-b border-black/[0.02]">
                          <td className="p-4 font-mono text-xs font-bold text-blue-600">{student.studentId}</td>
                          <td className="p-4 font-bold text-sm">{student.name}</td>
                          <td className="p-4">
                            <span className={cn(
                              "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                              student.status === 'Study' ? "bg-emerald-100 text-emerald-700" :
                              student.status === 'Trial' ? "bg-blue-100 text-blue-700" :
                              student.status === 'Pending' ? "bg-amber-100 text-amber-700" :
                              "bg-gray-100 text-gray-700"
                            )}>
                              {student.status}
                            </span>
                          </td>
                          <td className="p-4 text-sm">{student.phone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-black/20 p-12 text-center">
                <div className="w-24 h-24 bg-black/[0.02] rounded-full flex items-center justify-center mb-4">
                  <BookOpen size={48} />
                </div>
                <h3 className="text-xl font-bold text-black/40">Select a class</h3>
                <p className="text-sm max-w-xs mt-2">Choose a class from the left sidebar to view its student roster.</p>
              </div>
            )}
          </div>
        </div>
      )}    </div>
  );
}
