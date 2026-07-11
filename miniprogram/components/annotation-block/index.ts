// annotation-block：米诺批注块（左描金竖线引用块）。
// label 为「米诺批注」/「米诺一句话」；text 为引文。标识符英文、注释中文。
Component({
  options: { addGlobalClass: true },
  properties: {
    label: { type: String, value: '米诺批注' },
    text: { type: String, value: '' },
  },
});
