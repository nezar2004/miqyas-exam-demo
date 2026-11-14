// Build an uncompressed OOXML workbook. All cell values are inline strings.
function resultWorkbook(rows) {
  const encode=value=>new TextEncoder().encode(value);
  const xml=value=>String(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
  const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const packageRel='http://schemas.openxmlformats.org/package/2006/relationships';
  const files={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':`<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<workbook xmlns="${main}" xmlns:r="${rel}"><sheets><sheet name="Miqyas" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="${main}"><sheetData>${rows.map((row,i)=>`<row r="${i+1}">${row.map((value,j)=>{
      const address=String.fromCharCode(65+j)+(i+1);
      return typeof value==='number' && Number.isFinite(value)?`<c r="${address}"><v>${value}</v></c>`:
        `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join('')}</row>`).join('')}</sheetData></worksheet>`
  };
  function crc32(bytes) {
    let crc=-1;
    for (const byte of bytes) {
      crc^=byte;
      for (let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
    }
    return (crc^-1)>>>0;
  }
  function header(length,fields) {
    const bytes=new Uint8Array(length);
    const view=new DataView(bytes.buffer);
    for (const [offset,value,size] of fields) {
      if (size===4) view.setUint32(offset,value,true);
      else view.setUint16(offset,value,true);
    }
    return bytes;
  }
  const records=[],directory=[];
  let offset=0,directoryLength=0;
  for (const [path,source] of Object.entries(files)) {
    const name=encode(path),data=encode(source),crc=crc32(data);
    const local=header(30,[[0,0x04034b50,4],[4,20],[12,33],[14,crc,4],[18,data.length,4],[22,data.length,4],[26,name.length]]);
    const central=header(46,[[0,0x02014b50,4],[4,20],[6,20],[14,33],[16,crc,4],[20,data.length,4],[24,data.length,4],[28,name.length],[42,offset,4]]);
    records.push(local,name,data);
    directory.push(central,name);
    offset+=local.length+name.length+data.length;
    directoryLength+=central.length+name.length;
  }
  const count=Object.keys(files).length;
  return new Blob([...records,...directory,header(22,[[0,0x06054b50,4],[8,count],[10,count],[12,directoryLength,4],[16,offset,4]])],
    {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
