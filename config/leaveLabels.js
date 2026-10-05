// ชื่อประเภทการลาภาษาไทย — ใช้ร่วมกันในใบลา, อีเมลแจ้งเตือน, Teams (เดิมเขียนซ้ำ 4 ที่)
export const LEAVE_TYPE_LABELS = {
  sick: 'ลาป่วย',
  personal: 'ลากิจ',
  vacation: 'ลาพักร้อน',
  maternity: 'ลาคลอด',
  other: 'ลาอื่นๆ'
};

export const getLeaveTypeLabel = (type) => LEAVE_TYPE_LABELS[type] || type;
