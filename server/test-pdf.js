const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function test() {
  try {
    const buf = fs.readFileSync('../RAB_Subcontract_Sample_Public_Works.pdf');
    const parser = new PDFParse({ data: buf });
    console.log("Calling getText...");
    const textData = await parser.getText();
    console.log("Text length:", textData.text.length);
  } catch (err) {
    console.error(err);
  }
}
test();