import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateLecture(sourceText: string) {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ parts: [{ text: `Dựa trên tài liệu sau, hãy tạo một bài giảng chi tiết cho sinh viên đại học. 
    Bài giảng phải bao gồm:
    1. Giải thích chi tiết nội dung.
    2. Ví dụ minh họa cụ thể.
    3. Các khái niệm quan trọng.
    4. Tóm tắt cuối bài.
    
    Tài liệu: ${sourceText}` }] }],
    config: {
      temperature: 0.7,
    }
  });
  return response.text;
}

export async function generateTest(lectureContent: string) {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ parts: [{ text: `Dựa trên bài giảng sau, hãy tạo 15 câu hỏi trắc nghiệm. 
    Mỗi câu hỏi có 4 đáp án A, B, C, D và chỉ có 1 đáp án đúng.
    Trả về kết quả dưới dạng JSON array các object có cấu trúc: { "question": string, "options": string[], "correctAnswer": "A" | "B" | "C" | "D" }
    
    Bài giảng: ${lectureContent}` }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            correctAnswer: { type: Type.STRING, enum: ["A", "B", "C", "D"] }
          },
          required: ["question", "options", "correctAnswer"]
        }
      }
    }
  });
  
  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    console.error("Failed to parse test JSON", e);
    return [];
  }
}

export async function evaluateResult(score: number, total: number, studentName: string) {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{ parts: [{ text: `Sinh viên ${studentName} vừa hoàn thành bài test với điểm số ${score}/${total}. 
    Hãy đưa ra một nhận xét cá nhân ngắn gọn, công bằng và khuyến khích. 
    Nhận xét dựa trên điểm số:
    - 13-15: Xuất sắc
    - 10-12: Hiểu tốt
    - Dưới 10: Cần ôn tập thêm` }] }]
  });
  return response.text;
}

export async function chatWithAI(userMessage: string, lectureContent: string, history: any[]) {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      ...history,
      { role: 'user', parts: [{ text: userMessage }] }
    ],
    config: {
      systemInstruction: `Bạn là một trợ lý học tập thông minh. Bạn CHỈ ĐƯỢC PHÉP trả lời các câu hỏi dựa trên nội dung bài giảng sau đây. Nếu câu hỏi không liên quan đến bài giảng, hãy lịch sự từ chối và đề nghị sinh viên hỏi về nội dung bài học.
      
      NỘI DUNG BÀI GIẢNG:
      ${lectureContent}`,
      temperature: 0.3,
    }
  });
  return response.text;
}
