
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Plus, History, LayoutDashboard, Save, Trash2, Sparkles, 
  Download, Undo2, Redo2, Cloud, CloudOff, RefreshCw, AlertTriangle
} from 'lucide-react';
import { SIBLINGS, SiblingId, MonthlyRecord, TOTAL_SHARES } from './types';
import { getBillInsights } from './services/geminiService';
import * as driveService from './services/driveService';

const LOCAL_STORAGE_KEY = 'sibiwifi_records';

const App: React.FC = () => {
  const [records, setRecords] = useState<MonthlyRecord[]>([]);
  const [past, setPast] = useState<MonthlyRecord[][]>([]);
  const [future, setFuture] = useState<MonthlyRecord[][]>([]);
  
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [aiInsights, setAiInsights] = useState<string | null>(null);

  // Form States
  const [formMonth, setFormMonth] = useState('');
  const [formYear, setFormYear] = useState<number | string>(new Date().getFullYear());
  const [formTotalBill, setFormTotalBill] = useState(0);
  const [formPaid, setFormPaid] = useState<Record<SiblingId, number>>({ NI: 0, AM: 0, AD: 0, SB: 0 });

  // Drive States
  const [isDriveConnected, setIsDriveConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [driveFileId, setDriveFileId] = useState<string | null>(null);

  // Init Drive Client on mount
  useEffect(() => {
    driveService.initDrive().catch(err => console.warn("Drive init failed on start:", err));
  }, []);

  // Load from LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (saved) {
      try {
        setRecords(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse records", e);
      }
    }
  }, []);

  const syncWithCloud = async (currentRecords: MonthlyRecord[]) => {
    if (!isDriveConnected || !driveFileId) return;
    setIsSyncing(true);
    try {
      await driveService.updateFile(driveFileId, currentRecords);
    } catch (e) {
      console.error("Cloud sync failed", e);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(records));
  }, [records]);

  const handleConnectDrive = async () => {
    setIsSyncing(true);
    try {
      await driveService.authenticate();
      const file = await driveService.getFileData();
      
      if (file) {
        setDriveFileId(file.id);
        if (confirm("Found existing records in Google Drive. Sync with cloud records?")) {
          setRecords(file.records);
        }
      } else {
        const newFileId = await driveService.createFile(records);
        setDriveFileId(newFileId);
      }
      setIsDriveConnected(true);
    } catch (e: any) {
      console.error("Drive connection error:", e);
      
      if (e.error === 'access_denied' || (typeof e === 'string' && e.includes('access_denied'))) {
        alert("ACCESS DENIED: Your email is not added as a 'Test User' in the Google Cloud Project. \n\nFix: Ensure your email is added to 'Test users' in the OAuth consent screen of your GCP project.");
      } else {
        alert(e.message || "Connection failed. Please ensure the GOOGLE_CLIENT_ID environment variable is correctly configured.");
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const manualSync = async () => {
    if (!isDriveConnected) return;
    setIsSyncing(true);
    try {
      if (driveFileId) await driveService.updateFile(driveFileId, records);
    } catch (e) {
      alert("Manual sync failed.");
    } finally {
      setIsSyncing(false);
    }
  };

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setFuture(prev => [records, ...prev]);
    setPast(past.slice(0, past.length - 1));
    setRecords(previous);
    syncWithCloud(previous);
  }, [past, records, isDriveConnected, driveFileId]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setPast(prev => [...prev, records]);
    setFuture(future.slice(1));
    setRecords(next);
    syncWithCloud(next);
  }, [future, records, isDriveConnected, driveFileId]);

  const getMonthDate = (monthStr: string) => {
    const [m, y] = monthStr.split(' ');
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return new Date(parseInt(y), months.indexOf(m), 1);
  };

  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => getMonthDate(a.month).getTime() - getMonthDate(b.month).getTime());
  }, [records]);

  const lastMonthBalances = useMemo(() => {
    if (sortedRecords.length === 0) return { NI: 0, AM: 0, AD: 0, SB: 0 };
    return sortedRecords[sortedRecords.length - 1].balanceCarryForward;
  }, [sortedRecords]);

  const calculations = useMemo(() => {
    const sharePerUnit = formTotalBill / TOTAL_SHARES;
    const expected: Record<SiblingId, number> = {
      NI: Number((sharePerUnit * 2).toFixed(2)),
      AM: Number((sharePerUnit * 2).toFixed(2)),
      AD: Number((sharePerUnit * 1).toFixed(2)),
      SB: Number((sharePerUnit * 1).toFixed(2)),
    };
    const totalDue: Record<SiblingId, number> = {
      NI: Number((expected.NI + (lastMonthBalances.NI || 0)).toFixed(2)),
      AM: Number((expected.AM + (lastMonthBalances.AM || 0)).toFixed(2)),
      AD: Number((expected.AD + (lastMonthBalances.AD || 0)).toFixed(2)),
      SB: Number((expected.SB + (lastMonthBalances.SB || 0)).toFixed(2)),
    };
    const newBalance: Record<SiblingId, number> = {
      NI: Number((totalDue.NI - (formPaid.NI || 0)).toFixed(2)),
      AM: Number((totalDue.AM - (formPaid.AM || 0)).toFixed(2)),
      AD: Number((totalDue.AD - (formPaid.AD || 0)).toFixed(2)),
      SB: Number((totalDue.SB - (formPaid.SB || 0)).toFixed(2)),
    };
    return { expected, totalDue, newBalance };
  }, [formTotalBill, lastMonthBalances, formPaid]);

  const handleSave = async () => {
    if (!formMonth || formTotalBill <= 0) {
      alert("Please enter a valid month and bill amount.");
      return;
    }
    const monthLabel = `${formMonth} ${formYear}`;
    const newRecord: MonthlyRecord = {
      month: monthLabel,
      totalBill: formTotalBill,
      expected: calculations.expected,
      paid: formPaid,
      balanceCarryForward: calculations.newBalance
    };
    setPast(prev => [...prev, records]);
    setFuture([]);
    
    const newRecords = [...records];
    const index = newRecords.findIndex(r => r.month === monthLabel);
    if (index > -1) newRecords[index] = newRecord; else newRecords.push(newRecord);
    
    setRecords(newRecords);
    syncWithCloud(newRecords);
    setIsAddingNew(false);
    resetForm();
  };

  const resetForm = () => {
    setFormMonth('');
    setFormYear(new Date().getFullYear());
    setFormTotalBill(0);
    setFormPaid({ NI: 0, AM: 0, AD: 0, SB: 0 });
  };

  const deleteRecord = (month: string) => {
    if (confirm(`Delete record for ${month}?`)) {
      setPast(prev => [...prev, records]);
      setFuture([]);
      const newRecords = records.filter(r => r.month !== month);
      setRecords(newRecords);
      syncWithCloud(newRecords);
    }
  };

  const generateAIAnalysis = async () => {
    setLoadingInsights(true);
    const insights = await getBillInsights(sortedRecords);
    setAiInsights(insights);
    setLoadingInsights(false);
  };

  const currentSummary = sortedRecords.length > 0 
    ? sortedRecords[sortedRecords.length - 1].balanceCarryForward 
    : { NI: 0, AM: 0, AD: 0, SB: 0 };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
              <LayoutDashboard className="text-blue-600" />
              SibiWiFi Tracker
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-slate-500">Shared WiFi bill management</p>
              <div className={`h-1.5 w-1.5 rounded-full ${isDriveConnected ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>
              <span className="text-[10px] uppercase font-bold text-slate-400">
                {isDriveConnected ? 'Cloud Synced' : 'Local Only'}
              </span>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-2">
              {!isDriveConnected ? (
                <button 
                  onClick={handleConnectDrive}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors shadow-sm text-sm"
                >
                  <CloudOff size={16} className="text-slate-400" />
                  Connect Drive
                </button>
              ) : (
                <button 
                  onClick={manualSync}
                  disabled={isSyncing}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors shadow-sm text-sm disabled:opacity-50"
                >
                  {isSyncing ? <RefreshCw size={16} className="animate-spin" /> : <Cloud size={16} />}
                  Sync Now
                </button>
              )}
            </div>

            <div className="h-8 w-px bg-slate-200 mx-1 hidden md:block"></div>

            <div className="flex bg-white rounded-lg border border-slate-300 p-1 shadow-sm">
              <button 
                onClick={undo}
                disabled={past.length === 0}
                className="p-2 text-slate-600 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-30"
              >
                <Undo2 size={18} />
              </button>
              <button 
                onClick={redo}
                disabled={future.length === 0}
                className="p-2 text-slate-600 hover:bg-slate-100 rounded-md transition-colors disabled:opacity-30"
              >
                <Redo2 size={18} />
              </button>
            </div>
            
            <button 
              onClick={() => setIsAddingNew(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium text-sm"
            >
              <Plus size={18} />
              Add Month
            </button>
          </div>
        </header>

        {/* Current Balances Summary */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {SIBLINGS.map(sib => (
            <div key={sib.id} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{sib.name}'s Status</span>
                <div className={`text-2xl font-bold mt-1 ${currentSummary[sib.id] > 0 ? 'text-red-600' : currentSummary[sib.id] < 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                  {currentSummary[sib.id] > 0 ? `Owes ₹${currentSummary[sib.id]}` : currentSummary[sib.id] < 0 ? `Credit ₹${Math.abs(currentSummary[sib.id])}` : 'Settled'}
                </div>
              </div>
              <div className="mt-4 text-xs text-slate-400">Weight: {sib.weight}x Share</div>
            </div>
          ))}
        </section>

        {/* AI Insights Card */}
        {sortedRecords.length > 0 && (
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-blue-100 rounded-xl p-6 relative overflow-hidden shadow-sm">
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-indigo-900 flex items-center gap-2">
                  <Sparkles size={20} className="text-indigo-600" />
                  Gemini Billing Insights
                </h3>
                <button 
                  onClick={generateAIAnalysis}
                  disabled={loadingInsights}
                  className="text-xs font-medium bg-indigo-600 text-white px-3 py-1.5 rounded-full hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm"
                >
                  {loadingInsights ? 'Analyzing...' : 'Generate Insights'}
                </button>
              </div>
              {aiInsights && (
                <div className="text-slate-700 text-sm leading-relaxed whitespace-pre-line">
                  {aiInsights}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Records Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <History size={20} className="text-slate-400" />
              Billing History
            </h2>
          </div>
          <div className="overflow-x-auto">
            {sortedRecords.length === 0 ? (
              <div className="p-12 text-center text-slate-400 italic">
                No records found. Start by adding a new month.
              </div>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Month</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Total Bill</th>
                    {SIBLINGS.map(sib => (
                      <th key={sib.id} className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">{sib.name} Paid</th>
                    ))}
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...sortedRecords].reverse().map((record, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-6 py-4 font-semibold text-slate-700">{record.month}</td>
                      <td className="px-6 py-4 font-mono text-slate-600">₹{record.totalBill.toLocaleString()}</td>
                      {SIBLINGS.map(sib => (
                        <td key={sib.id} className="px-6 py-4 text-center">
                          <span className="text-slate-600 block">₹{record.paid[sib.id].toLocaleString()}</span>
                          <span className={`text-[10px] font-bold ${record.balanceCarryForward[sib.id] > 0 ? 'text-red-500' : record.balanceCarryForward[sib.id] < 0 ? 'text-emerald-500' : 'text-slate-300'}`}>
                            {record.balanceCarryForward[sib.id] > 0 ? `OWE ₹${record.balanceCarryForward[sib.id]}` : record.balanceCarryForward[sib.id] < 0 ? `CR ₹${Math.abs(record.balanceCarryForward[sib.id])}` : 'SETTLED'}
                          </span>
                        </td>
                      ))}
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => deleteRecord(record.month)}
                          className="p-2 text-slate-300 hover:text-red-600 transition-colors rounded-lg hover:bg-red-50"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Form Modal */}
      {isAddingNew && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">Add Monthly Bill</h2>
              <button onClick={() => setIsAddingNew(false)} className="text-slate-400 hover:text-slate-600 text-2xl">&times;</button>
            </div>
            
            <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Month</label>
                  <select 
                    value={formMonth}
                    onChange={(e) => setFormMonth(e.target.value)}
                    className="w-full p-2.5 border border-slate-300 rounded-lg"
                  >
                    <option value="">Select Month</option>
                    {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Year</label>
                  <input 
                    type="number" 
                    value={formYear} 
                    onChange={(e) => setFormYear(e.target.value)} 
                    className="w-full p-2.5 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Total Bill Amount (₹)</label>
                <input 
                  type="number"
                  value={formTotalBill || ''}
                  onChange={(e) => setFormTotalBill(Number(e.target.value))}
                  placeholder="e.g. 2000"
                  className="w-full p-3 border border-slate-300 rounded-lg text-lg font-semibold"
                />
              </div>

              <div className="space-y-4">
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Payment Breakdown</p>
                {SIBLINGS.map(sib => (
                  <div key={sib.id} className="p-4 bg-slate-50 rounded-xl grid grid-cols-1 md:grid-cols-12 gap-4 items-center border border-slate-100">
                    <div className="md:col-span-3">
                      <span className="font-bold text-slate-700">{sib.name}</span>
                      <span className="block text-[10px] text-slate-400">Share: {sib.weight}x</span>
                    </div>
                    <div className="md:col-span-5">
                      <label className="text-[10px] text-slate-400 uppercase font-bold mb-1 block">Actually Paid</label>
                      <input 
                        type="number"
                        value={formPaid[sib.id] || ''}
                        onChange={(e) => setFormPaid(prev => ({ ...prev, [sib.id]: Number(e.target.value) }))}
                        className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="md:col-span-4 text-right">
                      <div className="text-[10px] text-slate-400 uppercase font-bold">New Balance</div>
                      <div className={`text-sm font-bold ${calculations.newBalance[sib.id] > 0 ? 'text-red-600' : calculations.newBalance[sib.id] < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {calculations.newBalance[sib.id] > 0 ? `₹${calculations.newBalance[sib.id]}` : calculations.newBalance[sib.id] < 0 ? `-₹${Math.abs(calculations.newBalance[sib.id])}` : '0'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3 justify-end">
              <button onClick={() => { setIsAddingNew(false); resetForm(); }} className="px-6 py-2.5 text-slate-600">Cancel</button>
              <button onClick={handleSave} className="px-8 py-2.5 bg-blue-600 text-white rounded-lg font-semibold shadow-sm flex items-center gap-2">
                <Save size={18} /> Save Month
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
