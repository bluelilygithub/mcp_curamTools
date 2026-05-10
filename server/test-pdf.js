const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function test() {
  try {
    const buf = fs.readFileSync('../RAB_Subcontract_Sample_Public_Works.pdf');
    const parser = new PDFParse({ data: buf });
    const textData = await parser.getText();
    console.log("Text length:", textData.text.length);
    console.log("Preview:", textData.text.substring(0, 100));
  } catch (err) {
    console.error(err);
  }
}

test();
