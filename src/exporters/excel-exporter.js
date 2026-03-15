/**
 * Excel Exporter - Excel 导出器
 * 
 * 依赖：exceljs
 */

const { BaseExporter } = require('./base-exporter');
const fs = require('fs').promises;
const path = require('path');

class ExcelExporter extends BaseExporter {
  async export(data, filepath, options = {}) {
    // 动态导入 exceljs（避免启动时加载）
    const ExcelJS = require('exceljs');
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(options.sheetName || 'Sheet1');

    if (data.type === 'table') {
      await this._exportTable(worksheet, data.data, options);
    } else if (data.type === 'list') {
      await this._exportList(worksheet, data.data, options);
    } else {
      // 默认转为 JSON 字符串
      worksheet.addRow(['Data']);
      worksheet.addRow([JSON.stringify(data, null, 2)]);
    }

    await workbook.xlsx.writeFile(filepath);
    
    const stats = await fs.stat(filepath);
    console.log(`[ExcelExporter] Exported to ${filepath}, size: ${stats.size} bytes`);
    
    return { size: stats.size };
  }

  async _exportTable(worksheet, tableData, options) {
    // 设置列
    worksheet.columns = tableData.headers.map(h => ({
      header: h,
      key: h,
      width: 20
    }));

    // 设置表头样式
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // 写入数据行
    for (let rowIndex = 0; rowIndex < tableData.rows.length; rowIndex++) {
      const row = tableData.rows[rowIndex];
      const rowData = {};
      const images = []; // 需要插入的图片

      for (let i = 0; i < tableData.headers.length; i++) {
        const cell = row[i];
        const header = tableData.headers[i];

        if (cell && typeof cell === 'object' && cell.type === 'image') {
          // 图片数据
          if (cell.localPath) {
            images.push({
              path: cell.localPath,
              row: rowIndex + 2, // +2 因为表头是第1行
              col: i
            });
          }
          rowData[header] = cell.alt || '[图片]';
        } else {
          rowData[header] = cell;
        }
      }

      worksheet.addRow(rowData);

      // 插入图片
      for (const img of images) {
        try {
          await this._insertImage(worksheet, img.path, img.row, img.col);
        } catch (err) {
          console.warn(`[ExcelExporter] Failed to insert image: ${img.path}`, err.message);
        }
      }
    }

    // 自动调整行高（有图片的行）
    for (let i = 2; i <= tableData.rows.length + 1; i++) {
      worksheet.getRow(i).height = 80; // 图片行高度
    }
  }

  async _exportList(worksheet, listData, options) {
    worksheet.columns = [
      { header: 'Index', key: 'index', width: 10 },
      { header: 'Item', key: 'item', width: 50 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };

    listData.items.forEach((item, index) => {
      worksheet.addRow({
        index: index + 1,
        item: typeof item === 'object' ? JSON.stringify(item) : item
      });
    });
  }

  async _insertImage(worksheet, imagePath, row, col) {
    const ExcelJS = require('exceljs');
    
    // 读取图片文件获取尺寸
    const imageBuffer = await fs.readFile(imagePath);
    
    // 简单判断图片类型
    const ext = path.extname(imagePath).toLowerCase();
    let extension = 'png';
    if (ext === '.jpg' || ext === '.jpeg') extension = 'jpeg';
    if (ext === '.gif') extension = 'gif';

    const imageId = worksheet.workbook.addImage({
      buffer: imageBuffer,
      extension: extension
    });

    // 在单元格中插入图片，固定大小 100x100
    worksheet.addImage(imageId, {
      tl: { col: col, row: row - 1 },  // top-left，worksheet 是 0-based
      ext: { width: 100, height: 100 }
    });
  }

  getExtension() {
    return 'xlsx';
  }
}

module.exports = { ExcelExporter };
