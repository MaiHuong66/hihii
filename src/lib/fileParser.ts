import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';

// Cấu hình worker cho PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export async function parseFile(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'txt') {
    return await file.text();
  }

  if (extension === 'docx') {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  if (extension === 'xlsx' || extension === 'xls') {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer);
    let text = '';
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      text += XLSX.utils.sheet_to_txt(worksheet);
    });
    return text;
  }

  if (extension === 'pdf') {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    const pagePromises = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      pagePromises.push((async () => {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        return content.items.map((item: any) => (item as any).str).join(' ');
      })());
    }
    
    const pages = await Promise.all(pagePromises);
    return pages.join('\n');
  }

  if (['png', 'jpg', 'jpeg'].includes(extension || '')) {
    // Với ảnh, chúng ta có thể gửi trực tiếp cho Gemini nếu muốn, 
    // nhưng ở đây ta chỉ báo là "Image file uploaded" hoặc dùng Gemini Vision sau.
    return `[Nội dung từ hình ảnh: ${file.name}]`;
  }

  return '';
}
