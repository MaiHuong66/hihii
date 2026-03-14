/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  BookOpen, 
  ClipboardCheck, 
  User, 
  GraduationCap, 
  Send, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  LogOut,
  ChevronRight,
  MessageSquare,
  FileText,
  Table as TableIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { db, auth } from './firebase';
import { doc, setDoc, getDoc, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { generateLecture, generateTest, evaluateResult, chatWithAI } from './lib/gemini';
import { parseFile } from './lib/fileParser';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Components ---

const Button = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost', size?: 'sm' | 'md' | 'lg', isLoading?: boolean }>(
  ({ className, variant = 'primary', size = 'md', isLoading, children, ...props }, ref) => {
    const variants = {
      primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
      secondary: 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm',
      outline: 'border border-slate-200 bg-transparent hover:bg-slate-50 text-slate-700',
      ghost: 'bg-transparent hover:bg-slate-100 text-slate-600',
    };
    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2',
      lg: 'px-6 py-3 text-lg font-medium',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none',
          variants[variant],
          sizes[size],
          className
        )}
        disabled={isLoading}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);

const Card = ({ children, className }: { children: React.ReactNode, className?: string }) => (
  <div className={cn('bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden', className)}>
    {children}
  </div>
);

// --- Main App ---

type WindowType = 'upload' | 'lecture' | 'test' | 'results' | 'chat';

export default function App() {
  const [activeWindow, setActiveWindow] = useState<WindowType>('lecture');
  const [user, setUser] = useState<any>(null);
  const [isTeacher, setIsTeacher] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lecture, setLecture] = useState<any>(null);
  const [test, setTest] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  
  // Test State
  const [studentInfo, setStudentInfo] = useState({ name: '', class: '' });
  const [testStarted, setTestStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [testResult, setTestResult] = useState<any>(null);

  // Chat State
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !lecture?.content) return;

    const userMsg = chatInput;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', parts: [{ text: userMsg }] }]);
    setLoading(true);

    try {
      const response = await chatWithAI(userMsg, lecture.content, chatHistory);
      setChatHistory(prev => [...prev, { role: 'model', parts: [{ text: response }] }]);
    } catch (error) {
      console.error(error);
      alert('Lỗi khi chat với AI.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      // Check if teacher (hardcoded email for demo as per instructions)
      if (u?.email === 'lemaihuong06062004@gmail.com') {
        setIsTeacher(true);
      } else {
        setIsTeacher(false);
      }
    });

    // Listen for lecture
    const unsubLecture = onSnapshot(doc(db, 'lectures', 'current'), (doc) => {
      if (doc.exists()) setLecture(doc.data());
    });

    // Listen for test
    const unsubTest = onSnapshot(doc(db, 'tests', 'current'), (doc) => {
      if (doc.exists()) setTest(doc.data());
    });

    // Listen for results (only if teacher)
    let unsubResults: any;
    if (isTeacher) {
      const q = query(collection(db, 'results'), orderBy('createdAt', 'desc'));
      unsubResults = onSnapshot(q, (snapshot) => {
        setResults(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
      });
    }

    return () => {
      unsubscribe();
      unsubLecture();
      unsubTest();
      if (unsubResults) unsubResults();
    };
  }, [isTeacher]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const handleLogout = async () => {
    await signOut(auth);
    setIsTeacher(false);
  };

  // --- Window 1: Upload (Teacher) ---
  const [uploadText, setUploadText] = useState('');
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files) as File[];
      const oversizedFiles = files.filter(f => f.size > 10 * 1024 * 1024);
      
      if (oversizedFiles.length > 0) {
        alert(`Một số file vượt quá giới hạn 10MB: ${oversizedFiles.map(f => f.name).join(', ')}. Vui lòng chọn file nhỏ hơn.`);
        return;
      }
      
      setUploadFiles(prev => [...prev, ...files]);
    }
  };

  const handleSubmitTutor = async () => {
    if (!uploadText && uploadFiles.length === 0) return;
    setLoading(true);
    try {
      let fullText = uploadText;
      for (const file of uploadFiles) {
        const parsed = await parseFile(file);
        fullText += '\n\n' + parsed;
      }

      // 1. Generate Lecture and Test in parallel
      const [lectureContent, testQuestions] = await Promise.all([
        generateLecture(fullText),
        generateTest(fullText)
      ]);

      // 2. Save to Firestore
      await Promise.all([
        setDoc(doc(db, 'lectures', 'current'), {
          content: lectureContent,
          createdAt: serverTimestamp(),
          title: 'Bài giảng mới'
        }),
        setDoc(doc(db, 'tests', 'current'), {
          questions: testQuestions,
          createdAt: serverTimestamp()
        })
      ]);

      setUploadText('');
      setUploadFiles([]);
      alert('Tài liệu đã được xử lý thành công!');
      setActiveWindow('lecture');
    } catch (error) {
      console.error(error);
      alert('Có lỗi xảy ra khi xử lý tài liệu. Vui lòng thử lại với tài liệu ngắn hơn hoặc kiểm tra kết nối mạng.');
    } finally {
      setLoading(false);
    }
  };

  // --- Window 3: Test Logic ---
  const handleStartTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentInfo.name || !studentInfo.class) return;
    setTestStarted(true);
  };

  const handleAnswer = (qIdx: number, ans: string) => {
    setAnswers(prev => ({ ...prev, [qIdx]: ans }));
  };

  const handleSubmitTest = async () => {
    if (Object.keys(answers).length < (test?.questions?.length || 0)) {
      if (!confirm('Bạn chưa trả lời hết các câu hỏi. Vẫn muốn nộp bài?')) return;
    }

    setLoading(true);
    try {
      let score = 0;
      test.questions.forEach((q: any, idx: number) => {
        if (answers[idx] === q.correctAnswer) score++;
      });

      const total = test.questions.length;
      const feedback = await evaluateResult(score, total, studentInfo.name);
      
      let evaluation = 'Cần ôn tập thêm';
      if (score >= 13) evaluation = 'Xuất sắc';
      else if (score >= 10) evaluation = 'Hiểu tốt';

      const resultData = {
        studentName: studentInfo.name,
        className: studentInfo.class,
        score,
        total,
        evaluation,
        feedback,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'results'), resultData);
      setTestResult(resultData);
    } catch (error) {
      console.error(error);
      alert('Lỗi khi nộp bài.');
    } finally {
      setLoading(false);
    }
  };

  const resetTest = () => {
    setTestStarted(false);
    setAnswers({});
    setTestResult(null);
    setActiveWindow('lecture');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <GraduationCap className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">AI Tutor</h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex bg-slate-100 p-1 rounded-xl">
              <button 
                onClick={() => setActiveWindow('lecture')}
                className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-all', activeWindow === 'lecture' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700')}
              >
                Bài giảng
              </button>
              <button 
                onClick={() => setActiveWindow('chat')}
                className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-all', activeWindow === 'chat' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700')}
              >
                Hỏi đáp AI
              </button>
              <button 
                onClick={() => setActiveWindow('test')}
                className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-all', activeWindow === 'test' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700')}
              >
                Bài test
              </button>
              {isTeacher && (
                <>
                  <button 
                    onClick={() => setActiveWindow('upload')}
                    className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-all', activeWindow === 'upload' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700')}
                  >
                    Upload
                  </button>
                  <button 
                    onClick={() => setActiveWindow('results')}
                    className={cn('px-4 py-1.5 rounded-lg text-sm font-medium transition-all', activeWindow === 'results' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700')}
                  >
                    Bảng điểm
                  </button>
                </>
              )}
            </div>

            {user ? (
              <div className="flex items-center gap-3">
                <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full border border-slate-200" referrerPolicy="no-referrer" />
                <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <Button onClick={handleLogin} size="sm" variant="outline">
                <User className="w-4 h-4 mr-2" />
                Đăng nhập
              </Button>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {/* WINDOW 1: UPLOAD (TEACHER ONLY) */}
          {activeWindow === 'upload' && isTeacher && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold text-slate-900">Tải lên tài liệu giảng dạy</h2>
                <p className="text-slate-500">AI sẽ tự động tạo bài giảng và bài test từ nội dung của bạn.</p>
              </div>

              <Card className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Dán nội dung văn bản</label>
                  <textarea 
                    value={uploadText}
                    onChange={(e) => setUploadText(e.target.value)}
                    placeholder="Nhập hoặc dán nội dung tài liệu tại đây..."
                    className="w-full h-48 p-4 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all resize-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Hoặc tải lên tệp tin</label>
                  <div className="relative group">
                    <input 
                      type="file" 
                      multiple 
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      accept=".pdf,.docx,.xlsx,.xls,.txt,.png,.jpg,.jpeg"
                    />
                    <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center group-hover:border-indigo-400 transition-colors">
                      <Upload className="mx-auto w-10 h-10 text-slate-400 mb-2 group-hover:text-indigo-500 transition-colors" />
                      <p className="text-slate-600 font-medium">Kéo thả hoặc click để chọn file</p>
                      <p className="text-slate-400 text-xs mt-1">Hỗ trợ PDF, Word, Excel, Image, Text</p>
                    </div>
                  </div>
                  {uploadFiles.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {uploadFiles.map((f, i) => (
                        <div key={i} className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          {f.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Button 
                  onClick={handleSubmitTutor} 
                  className="w-full" 
                  size="lg"
                  isLoading={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Đang phân tích tài liệu & tạo bài học...
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5 mr-2" />
                      GỬI TÀI LIỆU (Submit)
                    </>
                  )}
                </Button>
              </Card>
            </motion.div>
          )}

          {/* WINDOW 2: LECTURE */}
          {activeWindow === 'lecture' && (
            <motion.div
              key="lecture"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {lecture ? (
                <>
                  <div className="text-center space-y-2">
                    <h2 className="text-3xl font-bold text-slate-900">Bài Giảng Chi Tiết</h2>
                    <p className="text-slate-500 italic">Dựa trên tài liệu giảng viên đã cung cấp</p>
                  </div>

                  <Card className="p-10 prose prose-indigo max-w-none">
                    <div className="whitespace-pre-wrap text-slate-700 leading-relaxed">
                      {lecture.content}
                    </div>
                  </Card>

                  <div className="flex justify-center pt-4">
                    <Button onClick={() => setActiveWindow('test')} size="lg" className="group">
                      HOÀN THÀNH BÀI HỌC
                      <ChevronRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-20 space-y-4">
                  <BookOpen className="w-16 h-16 text-slate-200 mx-auto" />
                  <p className="text-slate-400 text-lg">Chưa có bài giảng nào được tải lên.</p>
                  {isTeacher && (
                    <Button onClick={() => setActiveWindow('upload')} variant="outline">
                      Tải lên ngay
                    </Button>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* WINDOW 3: TEST */}
          {activeWindow === 'test' && (
            <motion.div
              key="test"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {!test ? (
                <div className="text-center py-20 space-y-4">
                  <ClipboardCheck className="w-16 h-16 text-slate-200 mx-auto" />
                  <p className="text-slate-400 text-lg">Chưa có bài test nào sẵn sàng.</p>
                </div>
              ) : testResult ? (
                <Card className="p-10 text-center space-y-6">
                  <div className="bg-indigo-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-10 h-10 text-indigo-600" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold">Kết quả của bạn: {testResult.score}/{testResult.total}</h3>
                    <div className={cn(
                      'inline-block px-4 py-1 rounded-full text-sm font-bold uppercase tracking-wider',
                      testResult.evaluation === 'Xuất sắc' ? 'bg-emerald-100 text-emerald-700' :
                      testResult.evaluation === 'Hiểu tốt' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                    )}>
                      {testResult.evaluation}
                    </div>
                  </div>
                  <div className="bg-slate-50 p-6 rounded-xl text-left border border-slate-100 italic text-slate-600">
                    "{testResult.feedback}"
                  </div>
                  
                  <div className="space-y-4 pt-4">
                    <h4 className="font-bold text-slate-900 text-left">Đáp án đúng:</h4>
                    <div className="grid gap-3 text-left">
                      {test.questions.map((q: any, i: number) => (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-white border border-slate-100">
                          <span className="font-bold text-indigo-600">Q{i+1}:</span>
                          <span className="text-sm">{q.correctAnswer} - {q.options[q.correctAnswer.charCodeAt(0) - 65]}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Button onClick={resetTest} variant="outline" className="mt-8">Làm lại bài học</Button>
                </Card>
              ) : !testStarted ? (
                <Card className="p-10 max-w-md mx-auto space-y-8">
                  <div className="text-center space-y-2">
                    <h3 className="text-2xl font-bold">Thông tin sinh viên</h3>
                    <p className="text-slate-500">Vui lòng nhập thông tin để bắt đầu bài test.</p>
                  </div>
                  <form onSubmit={handleStartTest} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Họ tên sinh viên</label>
                      <input 
                        required
                        type="text" 
                        value={studentInfo.name}
                        onChange={(e) => setStudentInfo({ ...studentInfo, name: e.target.value })}
                        className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="Nguyễn Văn A"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Tên lớp</label>
                      <input 
                        required
                        type="text" 
                        value={studentInfo.class}
                        onChange={(e) => setStudentInfo({ ...studentInfo, class: e.target.value })}
                        className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                        placeholder="K65-CNTT"
                      />
                    </div>
                    <Button type="submit" className="w-full" size="lg">BẮT ĐẦU LÀM BÀI</Button>
                  </form>
                </Card>
              ) : (
                <div className="space-y-8">
                  <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200 sticky top-24 z-10">
                    <div className="flex items-center gap-4">
                      <div className="text-sm font-medium text-slate-500">Sinh viên: <span className="text-slate-900">{studentInfo.name}</span></div>
                      <div className="text-sm font-medium text-slate-500">Lớp: <span className="text-slate-900">{studentInfo.class}</span></div>
                    </div>
                    <div className="text-indigo-600 font-bold">
                      {Object.keys(answers).length} / {test.questions.length} câu
                    </div>
                  </div>

                  <div className="space-y-6">
                    {test.questions.map((q: any, idx: number) => (
                      <div key={idx} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden p-8 space-y-6">
                        <div className="flex gap-4">
                          <span className="flex-shrink-0 w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center font-bold text-sm">
                            {idx + 1}
                          </span>
                          <h4 className="text-lg font-semibold text-slate-800 pt-0.5">{q.question}</h4>
                        </div>
                        <div className="grid gap-3 pl-12">
                          {q.options.map((opt: string, optIdx: number) => {
                            const label = String.fromCharCode(65 + optIdx);
                            const isSelected = answers[idx] === label;
                            const isAnswered = answers[idx] !== undefined;
                            const isCorrect = label === q.correctAnswer;
                            const isWrongSelection = isSelected && !isCorrect;

                            return (
                              <button
                                key={optIdx}
                                disabled={isAnswered}
                                onClick={() => handleAnswer(idx, label)}
                                className={cn(
                                  'flex items-center gap-4 p-4 rounded-xl border text-left transition-all relative',
                                  isSelected 
                                    ? (isCorrect ? 'bg-emerald-50 border-emerald-200 text-emerald-700 ring-1 ring-emerald-200' : 'bg-rose-50 border-rose-200 text-rose-700 ring-1 ring-rose-200')
                                    : (isAnswered && isCorrect ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-100 hover:border-slate-300 text-slate-600'),
                                  isAnswered && !isSelected && !isCorrect && 'opacity-50'
                                )}
                              >
                                <span className={cn(
                                  'w-6 h-6 rounded-full border flex items-center justify-center text-xs font-bold',
                                  isSelected 
                                    ? (isCorrect ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-rose-600 border-rose-600 text-white')
                                    : (isAnswered && isCorrect ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 text-slate-400')
                                )}>
                                  {label}
                                </span>
                                <span className="flex-1">{opt}</span>
                                {isAnswered && isCorrect && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                                {isAnswered && isWrongSelection && <AlertCircle className="w-5 h-5 text-rose-600" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-center pt-8">
                    <Button 
                      onClick={handleSubmitTest} 
                      size="lg" 
                      className="px-12"
                      isLoading={loading}
                    >
                      NỘP BÀI
                    </Button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* WINDOW 5: CHAT WITH AI */}
          {activeWindow === 'chat' && (
            <motion.div
              key="chat"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="h-[600px] flex flex-col"
            >
              <div className="text-center mb-6">
                <h2 className="text-3xl font-bold text-slate-900">Hỏi đáp AI</h2>
                <p className="text-slate-500">Đặt câu hỏi về nội dung bài giảng, AI sẽ trả lời dựa trên tài liệu.</p>
              </div>

              <Card className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50">
                  {chatHistory.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2">
                      <MessageSquare className="w-12 h-12 opacity-20" />
                      <p>Hãy đặt câu hỏi đầu tiên về bài học!</p>
                    </div>
                  )}
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={cn(
                      "flex",
                      msg.role === 'user' ? "justify-end" : "justify-start"
                    )}>
                      <div className={cn(
                        "max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm",
                        msg.role === 'user' 
                          ? "bg-indigo-600 text-white rounded-tr-none" 
                          : "bg-white border border-slate-100 text-slate-700 rounded-tl-none"
                      )}>
                        {msg.parts[0].text}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-slate-100 p-4 rounded-2xl rounded-tl-none shadow-sm">
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <form onSubmit={handleSendChatMessage} className="p-4 bg-white border-t border-slate-100 flex gap-2">
                  <input 
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={lecture ? "Hỏi về bài giảng..." : "Vui lòng đợi bài giảng được tải lên..."}
                    disabled={loading || !lecture}
                    className="flex-1 p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-slate-50"
                  />
                  <Button type="submit" isLoading={loading} disabled={!chatInput.trim() || !lecture}>
                    Gửi
                  </Button>
                </form>
              </Card>
            </motion.div>
          )}

          {/* WINDOW 4: RESULTS (TEACHER ONLY) */}
          {activeWindow === 'results' && isTeacher && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-bold text-slate-900">Bảng Điểm Sinh Viên</h2>
                <p className="text-slate-500">Danh sách kết quả làm bài test của tất cả sinh viên.</p>
              </div>

              <Card className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">STT</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Họ tên</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Lớp</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Điểm</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Đánh giá</th>
                      <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Thời gian</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {results.map((res, i) => (
                      <tr key={res.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 text-sm text-slate-500">{i + 1}</td>
                        <td className="px-6 py-4 text-sm font-semibold text-slate-900">{res.studentName}</td>
                        <td className="px-6 py-4 text-sm text-slate-600">{res.className}</td>
                        <td className="px-6 py-4 text-sm font-bold text-indigo-600">{res.score}/{res.total}</td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            'px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-tight',
                            res.evaluation === 'Xuất sắc' ? 'bg-emerald-100 text-emerald-700' :
                            res.evaluation === 'Hiểu tốt' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                          )}>
                            {res.evaluation}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-400">
                          {res.createdAt?.toDate().toLocaleString('vi-VN')}
                        </td>
                      </tr>
                    ))}
                    {results.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">Chưa có kết quả nào.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 mt-20 py-12 bg-white">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 opacity-50">
            <GraduationCap className="w-5 h-5" />
            <span className="text-sm font-medium">AI Tutor System &copy; 2026</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-400">
            <a href="#" className="hover:text-indigo-600 transition-colors">Hướng dẫn</a>
            <a href="#" className="hover:text-indigo-600 transition-colors">Chính sách</a>
            <a href="#" className="hover:text-indigo-600 transition-colors">Liên hệ</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
