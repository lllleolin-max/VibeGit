import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cloud,
  Code2,
  Copy,
  FileCode2,
  FilePlus2,
  FolderHeart,
  FolderOpen,
  GitCompareArrows,
  HardDrive,
  History,
  Languages,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import appLogo from './assets/vibegit-app-icon-rounded.png'
import type {
  AgentEventRecord,
  AgentConnectionStatus,
  ApiResult,
  AppSettings,
  Checkpoint,
  CheckpointDiff,
  EnvironmentCheckResult,
  FeatureChangeSummary,
  GitHubCliStatus,
  Project,
  PublicError,
  RestorePreview,
  RestoreRecord,
  SensitiveRisk,
  SensitiveScanResult,
  ShelvedChange
} from '@vibegit/shared'

type Page = 'projects' | 'project' | 'settings'
type Modal =
  | { kind: 'save' }
  | { kind: 'restore'; preview: RestorePreview; checkpoint: Checkpoint }
  | { kind: 'backup' }
  | { kind: 'shelf' }
  | { kind: 'remove-project'; project: Project }
  | { kind: 'rename-checkpoint'; checkpoint: Checkpoint }
  | { kind: 'delete-checkpoint'; checkpoint: Checkpoint }
  | null

type DisplayLanguage = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'ru' | 'ar'
type ChangePresentation = 'feature' | 'code'

const DISPLAY_LANGUAGES: ReadonlyArray<{ value: DisplayLanguage; label: string; nativeLabel: string; direction: 'ltr' | 'rtl' }> = [
  { value: 'zh-CN', label: '简体中文', nativeLabel: '简体中文', direction: 'ltr' },
  { value: 'zh-TW', label: '繁體中文', nativeLabel: '繁體中文', direction: 'ltr' },
  { value: 'en', label: 'English', nativeLabel: 'English', direction: 'ltr' },
  { value: 'ja', label: '日语', nativeLabel: '日本語', direction: 'ltr' },
  { value: 'ko', label: '韩语', nativeLabel: '한국어', direction: 'ltr' },
  { value: 'ru', label: '俄语', nativeLabel: 'Русский', direction: 'ltr' },
  { value: 'ar', label: '阿拉伯语', nativeLabel: 'العربية', direction: 'rtl' }
]

const LANGUAGE_STORAGE_KEY = 'vibegit.display-language'
const CHANGE_PRESENTATION_STORAGE_KEY = 'vibegit.change-presentation'
const ORIGINAL_TEXT_BY_NODE = new WeakMap<Text, string>()
const RENDERED_TEXT_BY_NODE = new WeakMap<Text, string>()

type TranslationSet = Partial<Record<DisplayLanguage, string>>

const UI_TRANSLATIONS: Record<string, TranslationSet> = {
  '所有项目': { 'zh-TW': '所有專案', en: 'All projects', ja: 'すべてのプロジェクト', ko: '모든 프로젝트', ru: 'Все проекты', ar: 'كل المشاريع' },
  '最近项目': { 'zh-TW': '最近專案', en: 'Recent projects', ja: '最近のプロジェクト', ko: '최근 프로젝트', ru: 'Недавние проекты', ar: 'المشاريع الأخيرة' },
  '添加项目': { 'zh-TW': '新增專案', en: 'Add project', ja: 'プロジェクトを追加', ko: '프로젝트 추가', ru: 'Добавить проект', ar: 'إضافة مشروع' },
  '设置与连接': { 'zh-TW': '設定與連線', en: 'Settings & connections', ja: '設定と接続', ko: '설정 및 연결', ru: 'Настройки и подключения', ar: 'الإعدادات والاتصالات' },
  '选择项目文件夹': { 'zh-TW': '選擇專案資料夾', en: 'Choose project folder', ja: 'プロジェクトフォルダーを選択', ko: '프로젝트 폴더 선택', ru: 'Выбрать папку проекта', ar: 'اختر مجلد المشروع' },
  '为这个项目开启版本保护': { 'zh-TW': '為這個專案開啟版本保護', en: 'Enable version protection for this project', ja: 'このプロジェクトのバージョン保護を有効にする', ko: '이 프로젝트의 버전 보호 켜기', ru: 'Включить защиту версий для проекта', ar: 'تفعيل حماية الإصدارات لهذا المشروع' },
  '开启版本保护': { 'zh-TW': '開啟版本保護', en: 'Enable version protection', ja: 'バージョン保護を有効化', ko: '버전 보호 켜기', ru: 'Включить защиту версий', ar: 'تفعيل حماية الإصدارات' },
  '手动保存': { 'zh-TW': '手動儲存', en: 'Save checkpoint', ja: '手動保存', ko: '수동 저장', ru: 'Сохранить точку', ar: 'حفظ نقطة' },
  '保存点': { 'zh-TW': '儲存點', en: 'Checkpoints', ja: '保存ポイント', ko: '저장 지점', ru: 'Точки сохранения', ar: 'نقاط الحفظ' },
  '版本保护': { 'zh-TW': '版本保護', en: 'Version protection', ja: 'バージョン保護', ko: '버전 보호', ru: 'Защита версий', ar: 'حماية الإصدارات' },
  '安全回退': { 'zh-TW': '安全回退', en: 'Safe restore', ja: '安全に復元', ko: '안전하게 복원', ru: 'Безопасное восстановление', ar: 'استعادة آمنة' },
  'GitHub 备份': { 'zh-TW': 'GitHub 備份', en: 'GitHub backup', ja: 'GitHub バックアップ', ko: 'GitHub 백업', ru: 'Резервная копия GitHub', ar: 'نسخ GitHub الاحتياطي' },
  '界面语言': { 'zh-TW': '介面語言', en: 'Interface language', ja: '表示言語', ko: '표시 언어', ru: 'Язык интерфейса', ar: 'لغة الواجهة' },
  '显示语言': { 'zh-TW': '顯示語言', en: 'Display language', ja: '表示言語', ko: '표시 언어', ru: 'Язык отображения', ar: 'لغة العرض' },
  '本地数据': { 'zh-TW': '本機資料', en: 'Local data', ja: 'ローカルデータ', ko: '로컬 데이터', ru: 'Локальные данные', ar: 'البيانات المحلية' },
  '本地记录位置': { 'zh-TW': '本機記錄位置', en: 'Local record location', ja: 'ローカル記録の場所', ko: '로컬 기록 위치', ru: 'Расположение локальных записей', ar: 'موقع السجلات المحلية' },
  '选择文件夹': { 'zh-TW': '選擇資料夾', en: 'Choose folder', ja: 'フォルダーを選択', ko: '폴더 선택', ru: 'Выбрать папку', ar: 'اختر مجلداً' },
  '配置环境': { 'zh-TW': '設定環境', en: 'Environment setup', ja: '環境設定', ko: '환경 설정', ru: 'Настройка окружения', ar: 'إعداد البيئة' },
  '检测配置环境': { 'zh-TW': '檢測設定環境', en: 'Check environment', ja: '環境を確認', ko: '환경 확인', ru: 'Проверить окружение', ar: 'فحص البيئة' },
  'VibeGit 改动说明 Skill：': { 'zh-TW': 'VibeGit 變更說明 Skill：', en: 'VibeGit change-summary skill: ', ja: 'VibeGit 変更要約スキル：', ko: 'VibeGit 변경 요약 Skill: ', ru: 'Навык сводки изменений VibeGit: ', ar: 'مهارة ملخص تغييرات VibeGit: ' },
  '扫描 GitHub CLI、Codex、Claude Code 和 VibeGit 改动说明 Skill。缺少 GitHub CLI 时会通过 Windows 包管理器自动安装。': { 'zh-TW': '掃描 GitHub CLI、Codex、Claude Code 與 VibeGit 變更說明 Skill。缺少 GitHub CLI 時會透過 Windows 套件管理員自動安裝。', en: 'Scan GitHub CLI, Codex, Claude Code, and the VibeGit change-summary skill. GitHub CLI is installed automatically through Windows Package Manager when missing.', ja: 'GitHub CLI、Codex、Claude Code、VibeGit 変更要約スキルを確認します。GitHub CLI が見つからない場合は、Windows パッケージ マネージャーで自動インストールします。', ko: 'GitHub CLI, Codex, Claude Code 및 VibeGit 변경 요약 Skill을 검사합니다. GitHub CLI가 없으면 Windows 패키지 관리자로 자동 설치합니다.', ru: 'Проверяет GitHub CLI, Codex, Claude Code и навык сводки изменений VibeGit. Если GitHub CLI отсутствует, он будет автоматически установлен через диспетчер пакетов Windows.', ar: 'يفحص GitHub CLI وCodex وClaude Code ومهارة ملخص تغييرات VibeGit. عند عدم وجود GitHub CLI، يُثبَّت تلقائياً عبر مدير حزم Windows.' },
  '没有需要部署的 Agent': { 'zh-TW': '沒有需要部署的 Agent', en: 'No installed Agent needs it', ja: '配置が必要な Agent はありません', ko: '배포가 필요한 설치된 Agent가 없습니다', ru: 'Нет установленного Agent, которому нужен навык', ar: 'لا يوجد وكيل مثبّت يحتاج إلى المهارة' },
  '已部署': { 'zh-TW': '已部署', en: 'Installed', ja: '導入済み', ko: '설치됨', ru: 'Установлен', ar: 'تم التثبيت' },
  '待部署': { 'zh-TW': '待部署', en: 'Needs installation', ja: '導入が必要', ko: '설치 필요', ru: 'Требуется установка', ar: 'يتطلب التثبيت' },
  '未部署 VibeGit 改动说明 Skill': { 'zh-TW': '尚未部署 VibeGit 變更說明 Skill', en: 'VibeGit change-summary skill is not installed', ja: 'VibeGit 変更要約スキルが導入されていません', ko: 'VibeGit 변경 요약 Skill이 설치되지 않았습니다', ru: 'Навык сводки изменений VibeGit не установлен', ar: 'مهارة ملخص تغييرات VibeGit غير مثبتة' },
  '为了让保存点显示“功能变化”，请把下面英文指令复制给 Codex 或 Claude Code 并发送。它只会为本机已安装的 Agent 创建 VibeGit Skill。': { 'zh-TW': '為了讓儲存點顯示「功能變化」，請將下方英文指令複製給 Codex 或 Claude Code 並傳送。它只會為本機已安裝的 Agent 建立 VibeGit Skill。', en: 'To show feature changes in checkpoints, copy the English instruction below into Codex or Claude Code. It creates the VibeGit skill only for Agents installed on this computer.', ja: '保存ポイントに機能の変更を表示するには、以下の英語の指示を Codex または Claude Code にコピーして送信してください。このコンピューターにインストールされている Agent にのみ VibeGit スキルを作成します。', ko: '저장 지점에 기능 변경을 표시하려면 아래 영어 지시문을 Codex 또는 Claude Code에 복사해 보내세요. 이 컴퓨터에 설치된 Agent에만 VibeGit Skill을 만듭니다.', ru: 'Чтобы показывать изменения функций в точках сохранения, скопируйте английскую инструкцию ниже в Codex или Claude Code. Она создаст навык VibeGit только для Agent, установленных на этом компьютере.', ar: 'لعرض تغييرات الميزات في نقاط الحفظ، انسخ التعليمات الإنجليزية أدناه إلى Codex أو Claude Code. وهي تنشئ مهارة VibeGit للوكلاء المثبتين على هذا الكمبيوتر فقط.' },
  '检测到至少一个已安装的 Agent 缺少此 Skill；代码变更视图仍可正常使用。': { 'zh-TW': '偵測到至少一個已安裝的 Agent 缺少此 Skill；程式碼變更檢視仍可正常使用。', en: 'At least one installed Agent is missing this skill; the code-change view remains available.', ja: '少なくとも 1 つのインストール済み Agent にこのスキルがありません。コード変更ビューは引き続き利用できます。', ko: '설치된 Agent 중 하나 이상에 이 Skill이 없습니다. 코드 변경 보기는 계속 사용할 수 있습니다.', ru: 'Как минимум у одного установленного Agent нет этого навыка; просмотр изменений кода по-прежнему доступен.', ar: 'يفتقد وكيل مثبّت واحد على الأقل هذه المهارة؛ وتبقى واجهة تغييرات الكود متاحة.' },
  '复制英文部署指令': { 'zh-TW': '複製英文部署指令', en: 'Copy English deployment instruction', ja: '英語の導入指示をコピー', ko: '영문 배포 지시문 복사', ru: 'Скопировать инструкцию по установке на английском', ar: 'نسخ تعليمات النشر بالإنجليزية' },
  '已复制': { 'zh-TW': '已複製', en: 'Copied', ja: 'コピーしました', ko: '복사됨', ru: 'Скопировано', ar: 'تم النسخ' },
  'Agent 连接': { 'zh-TW': 'Agent 連線', en: 'Agent connections', ja: 'Agent 接続', ko: 'Agent 연결', ru: 'Подключения Agent', ar: 'اتصالات الوكلاء' },
  '默认安全规则': { 'zh-TW': '預設安全規則', en: 'Default safety rules', ja: '既定の安全ルール', ko: '기본 안전 규칙', ru: 'Правила безопасности по умолчанию', ar: 'قواعد الأمان الافتراضية' },
  'GitHub 私有备份': { 'zh-TW': 'GitHub 私人備份', en: 'GitHub private backup', ja: 'GitHub 非公開バックアップ', ko: 'GitHub 비공개 백업', ru: 'Приватное резервное копирование GitHub', ar: 'نسخ GitHub الاحتياطي الخاص' },
  '创建新的私有仓库': { 'zh-TW': '建立新的私人儲存庫', en: 'Create a new private repository', ja: '新しい非公開リポジトリを作成', ko: '새 비공개 저장소 만들기', ru: 'Создать новый приватный репозиторий', ar: 'إنشاء مستودع خاص جديد' },
  '连接现有私有仓库': { 'zh-TW': '連接現有私人儲存庫', en: 'Connect an existing private repository', ja: '既存の非公開リポジトリに接続', ko: '기존 비공개 저장소 연결', ru: 'Подключить существующий приватный репозиторий', ar: 'ربط مستودع خاص موجود' },
  '返回': { 'zh-TW': '返回', en: 'Back', ja: '戻る', ko: '뒤로', ru: 'Назад', ar: 'رجوع' },
  '保存': { 'zh-TW': '儲存', en: 'Save', ja: '保存', ko: '저장', ru: 'Сохранить', ar: 'حفظ' },
  '已检测': { 'zh-TW': '已檢測', en: 'Detected', ja: '検出済み', ko: '감지됨', ru: 'Обнаружено', ar: 'تم الكشف' },
  '未找到': { 'zh-TW': '未找到', en: 'Not found', ja: '見つかりません', ko: '찾을 수 없음', ru: 'Не найдено', ar: 'غير موجود' },
  '尚未检测': { 'zh-TW': '尚未檢測', en: 'Not checked yet', ja: '未確認', ko: '아직 확인되지 않음', ru: 'Еще не проверено', ar: 'لم يتم الفحص بعد' },
  '项目时间线': { 'zh-TW': '專案時間線', en: 'Project timeline', ja: 'プロジェクトのタイムライン', ko: '프로젝트 타임라인', ru: 'Хронология проекта', ar: 'المخطط الزمني للمشروع' },
  '你的安全保存记录': { 'zh-TW': '你的安全儲存記錄', en: 'Your safe save history', ja: '安全な保存履歴', ko: '안전한 저장 기록', ru: 'История безопасных сохранений', ar: 'سجل الحفظ الآمن' },
  ' 个保存点': { 'zh-TW': ' 個儲存點', en: ' checkpoints', ja: ' 個の保存ポイント', ko: '개의 저장 지점', ru: ' точек сохранения', ar: ' نقاط حفظ' },
  '初始化项目': { 'zh-TW': '初始化專案', en: 'Initialize project', ja: 'プロジェクトを初期化', ko: '프로젝트 초기화', ru: 'Инициализировать проект', ar: 'تهيئة المشروع' },
  '初始保护': { 'zh-TW': '初始保護', en: 'Initial protection', ja: '初期保護', ko: '초기 보호', ru: 'Начальная защита', ar: 'الحماية الأولية' },
  '未关联测试': { 'zh-TW': '未關聯測試', en: 'No linked tests', ja: '関連テストなし', ko: '연결된 테스트 없음', ru: 'Нет связанных тестов', ar: 'لا توجد اختبارات مرتبطة' },
  '仅保存在本机': { 'zh-TW': '僅儲存在本機', en: 'Stored locally only', ja: 'ローカル保存のみ', ko: '로컬에만 저장됨', ru: 'Сохранено только локально', ar: 'محفوظ محليًا فقط' },
  '查看这次改了什么': { 'zh-TW': '查看這次改了什麼', en: 'See what changed', ja: '今回の変更を見る', ko: '이번 변경 보기', ru: 'Посмотреть изменения', ar: 'عرض ما تغيّر' },
  '查看功能变化': { 'zh-TW': '查看功能變化', en: 'View feature changes', ja: '機能の変更を見る', ko: '기능 변경 보기', ru: 'Посмотреть изменения функций', ar: 'عرض تغييرات الميزات' },
  '查看代码变更': { 'zh-TW': '查看程式碼變更', en: 'View code changes', ja: 'コード変更を見る', ko: '코드 변경 보기', ru: 'Посмотреть изменения кода', ar: 'عرض تغييرات الكود' },
  '保存点显示方式': { 'zh-TW': '儲存點顯示方式', en: 'Checkpoint display', ja: '保存ポイントの表示', ko: '저장 지점 표시', ru: 'Отображение точек сохранения', ar: 'عرض نقاط الحفظ' },
  '为非程序员显示大白话的功能变化；也可随时切回完整代码差异。': { 'zh-TW': '為非程式設計師顯示白話的功能變化；也可隨時切回完整程式碼差異。', en: 'Show plain-language feature changes, or switch back to full code diffs at any time.', ja: '非プログラマー向けに機能の変更を分かりやすく表示し、いつでも完全なコード差分に切り替えられます。', ko: '비개발자에게 쉬운 기능 변경을 보여 주며 언제든 전체 코드 차이로 전환할 수 있습니다.', ru: 'Показывайте понятные изменения функций или в любой момент вернитесь к полным различиям кода.', ar: 'اعرض تغييرات الميزات بلغة بسيطة، أو عد إلى فروق الكود الكاملة في أي وقت.' },
  '功能变化': { 'zh-TW': '功能變化', en: 'Feature changes', ja: '機能の変更', ko: '기능 변경', ru: 'Изменения функций', ar: 'تغييرات الميزات' },
  '新增、改进和删除了哪些功能': { 'zh-TW': '新增、改進和刪除了哪些功能', en: 'Features added, improved, and removed', ja: '追加・改善・削除された機能', ko: '추가·개선·삭제된 기능', ru: 'Добавленные, улучшенные и удаленные функции', ar: 'الميزات المضافة والمحسّنة والمحذوفة' },
  '代码变更': { 'zh-TW': '程式碼變更', en: 'Code changes', ja: 'コード変更', ko: '코드 변경', ru: 'Изменения кода', ar: 'تغييرات الكود' },
  '文件列表与逐行代码差异': { 'zh-TW': '檔案清單與逐行程式碼差異', en: 'File list and line-by-line code diff', ja: 'ファイル一覧と行ごとのコード差分', ko: '파일 목록과 줄 단위 코드 차이', ru: 'Список файлов и построчные различия кода', ar: 'قائمة الملفات وفروق الكود سطرًا بسطر' },
  '这次的功能变化': { 'zh-TW': '這次的功能變化', en: 'Feature changes in this save', ja: '今回の機能変更', ko: '이번 저장의 기능 변경', ru: 'Изменения функций в этом сохранении', ar: 'تغييرات الميزات في هذا الحفظ' },
  '新增了什么': { 'zh-TW': '新增了什麼', en: 'What was added', ja: '追加されたこと', ko: '새로 추가된 내용', ru: 'Что добавлено', ar: 'ما تمت إضافته' },
  '改进了什么': { 'zh-TW': '改進了什麼', en: 'What was improved', ja: '改善されたこと', ko: '개선된 내용', ru: 'Что улучшено', ar: 'ما تم تحسينه' },
  '删除了什么': { 'zh-TW': '刪除了什麼', en: 'What was removed', ja: '削除されたこと', ko: '삭제된 내용', ru: 'Что удалено', ar: 'ما تمت إزالته' },
  '这次还没有功能说明': { 'zh-TW': '這次還沒有功能說明', en: 'There is no feature summary for this save yet', ja: 'この保存にはまだ機能の説明がありません', ko: '이 저장에는 아직 기능 설명이 없습니다', ru: 'Для этого сохранения пока нет описания функций', ar: 'لا يوجد ملخص للميزات لهذا الحفظ بعد' },
  '让 Codex 或 Claude Code 在完成任务后使用 VibeGit 的改动说明技能；下一次保存点会显示大白话总结。': { 'zh-TW': '讓 Codex 或 Claude Code 在完成任務後使用 VibeGit 的改動說明技能；下一個儲存點會顯示白話總結。', en: 'Have Codex or Claude Code use VibeGit’s change-summary skill after the task; the next checkpoint will show a plain-language summary.', ja: 'タスク完了後に Codex または Claude Code に VibeGit の変更要約スキルを使わせてください。次の保存ポイントに分かりやすい要約が表示されます。', ko: '작업 후 Codex 또는 Claude Code가 VibeGit 변경 요약 스킬을 사용하면 다음 저장 지점에 쉬운 요약이 표시됩니다.', ru: 'Попросите Codex или Claude Code использовать навык VibeGit для сводки изменений после задачи; в следующей точке сохранения появится понятное резюме.', ar: 'اجعل Codex أو Claude Code يستخدم مهارة تلخيص تغييرات VibeGit بعد المهمة؛ وستظهر خلاصة مبسطة في نقطة الحفظ التالية.' }
  , '保护中': { 'zh-TW': '保護中', en: 'Protected', ja: '保護中', ko: '보호 중', ru: 'Защищено', ar: 'محمي' }
  , '尚未保护': { 'zh-TW': '尚未保護', en: 'Not protected', ja: '未保護', ko: '보호되지 않음', ru: 'Не защищено', ar: 'غير محمي' }
  , '创建保存点': { 'zh-TW': '建立儲存點', en: 'Create checkpoint', ja: '保存ポイントを作成', ko: '저장 지점 만들기', ru: 'Создать точку сохранения', ar: 'إنشاء نقطة حفظ' }
  , '暂时收起': { 'zh-TW': '暫時收起', en: 'Stash changes', ja: '変更を一時退避', ko: '변경 사항 임시 보관', ru: 'Временно скрыть изменения', ar: 'إخفاء التغييرات مؤقتًا' }
  , '有新的修改': { 'zh-TW': '有新的修改', en: 'New changes found', ja: '新しい変更があります', ko: '새 변경 사항이 있습니다', ru: 'Есть новые изменения', ar: 'توجد تغييرات جديدة' }
  , '当前版本已保存': { 'zh-TW': '目前版本已儲存', en: 'Current version saved', ja: '現在のバージョンは保存済み', ko: '현재 버전이 저장됨', ru: 'Текущая версия сохранена', ar: 'تم حفظ الإصدار الحالي' }
  , '已安全备份': { 'zh-TW': '已安全備份', en: 'Safely backed up', ja: '安全にバックアップ済み', ko: '안전하게 백업됨', ru: 'Безопасно сохранено в резервной копии', ar: 'تم النسخ الاحتياطي بأمان' }
  , '等待备份': { 'zh-TW': '等待備份', en: 'Waiting to back up', ja: 'バックアップ待ち', ko: '백업 대기 중', ru: 'Ожидает резервного копирования', ar: 'بانتظار النسخ الاحتياطي' }
  , '尚未设置备份': { 'zh-TW': '尚未設定備份', en: 'Backup not set up', ja: 'バックアップ未設定', ko: '백업이 설정되지 않음', ru: 'Резервное копирование не настроено', ar: 'لم يتم إعداد النسخ الاحتياطي' }
  , '任务完成，但没有检测到文件变化': { 'zh-TW': '任務完成，但沒有偵測到檔案變化', en: 'Task completed, but no file changes were found', ja: 'タスクは完了しましたが、ファイルの変更は見つかりませんでした', ko: '작업이 완료되었지만 파일 변경을 찾지 못했습니다', ru: 'Задача завершена, но изменения файлов не обнаружены', ar: 'اكتملت المهمة، ولكن لم يتم العثور على تغييرات في الملفات' }
  , '测试通过': { 'zh-TW': '測試通過', en: 'Tests passed', ja: 'テスト成功', ko: '테스트 통과', ru: 'Тесты пройдены', ar: 'نجحت الاختبارات' }
  , '测试未通过': { 'zh-TW': '測試未通過', en: 'Tests failed', ja: 'テスト失敗', ko: '테스트 실패', ru: 'Тесты не пройдены', ar: 'فشلت الاختبارات' }
  , '已备份': { 'zh-TW': '已備份', en: 'Backed up', ja: 'バックアップ済み', ko: '백업됨', ru: 'Сохранено в резервной копии', ar: 'تم النسخ الاحتياطي' }
  , '回到这个版本': { 'zh-TW': '回到這個版本', en: 'Restore this version', ja: 'このバージョンに戻す', ko: '이 버전으로 복원', ru: 'Восстановить эту версию', ar: 'استعادة هذا الإصدار' }
  , '当时交给 Agent 的任务': { 'zh-TW': '當時交給 Agent 的任務', en: 'Task given to the Agent', ja: 'Agent に渡したタスク', ko: 'Agent에게 전달한 작업', ru: 'Задача, поставленная Agent', ar: 'المهمة المعطاة للوكيل' }
  , '正在整理这次修改…': { 'zh-TW': '正在整理這次修改…', en: 'Preparing these changes…', ja: 'この変更を整理中…', ko: '이번 변경을 정리하는 중…', ru: 'Подготавливаем эти изменения…', ar: 'جارٍ إعداد هذه التغييرات…' }
  , '这个保存点没有文件内容变化': { 'zh-TW': '這個儲存點沒有檔案內容變化', en: 'This checkpoint has no file content changes', ja: 'この保存ポイントにはファイル内容の変更がありません', ko: '이 저장 지점에는 파일 내용 변경이 없습니다', ru: 'В этой точке сохранения нет изменений содержимого файлов', ar: 'لا توجد تغييرات في محتوى الملفات في نقطة الحفظ هذه' }
  , '它用于记录一个安全边界。': { 'zh-TW': '它用於記錄一個安全邊界。', en: 'It records a safe boundary.', ja: '安全な境界を記録するためのものです。', ko: '안전한 경계를 기록하는 데 사용됩니다.', ru: 'Она фиксирует безопасную границу.', ar: 'تسجل حدًا آمنًا.' }
  , '修改的文件': { 'zh-TW': '修改的檔案', en: 'Changed files', ja: '変更されたファイル', ko: '변경된 파일', ru: 'Измененные файлы', ar: 'الملفات التي تم تغييرها' }
  , '新增': { 'zh-TW': '新增', en: 'Added', ja: '追加', ko: '추가됨', ru: 'Добавлено', ar: 'تمت الإضافة' }
  , '删除': { 'zh-TW': '刪除', en: 'Deleted', ja: '削除', ko: '삭제됨', ru: 'Удалено', ar: 'تم الحذف' }
  , '改名': { 'zh-TW': '改名', en: 'Renamed', ja: '名前変更', ko: '이름 변경됨', ru: 'Переименовано', ar: 'تمت إعادة التسمية' }
  , '修改': { 'zh-TW': '修改', en: 'Modified', ja: '変更', ko: '수정됨', ru: 'Изменено', ar: 'تم التعديل' }
  , '保护引擎状态': { 'zh-TW': '保護引擎狀態', en: 'Protection engine status', ja: '保護エンジンの状態', ko: '보호 엔진 상태', ru: 'Состояние движка защиты', ar: 'حالة محرك الحماية' }
  , '这些信息用于确认 VibeGit 能否自动保存每轮 Agent 修改。': { 'zh-TW': '這些資訊用於確認 VibeGit 能否自動儲存每輪 Agent 修改。', en: 'These details confirm whether VibeGit can automatically save each Agent change.', ja: 'これらの情報で、VibeGit が Agent の各変更を自動保存できるか確認します。', ko: '이 정보는 VibeGit이 각 Agent 변경을 자동 저장할 수 있는지 확인합니다.', ru: 'Эти сведения подтверждают, может ли VibeGit автоматически сохранять каждое изменение Agent.', ar: 'تؤكد هذه التفاصيل ما إذا كان VibeGit يستطيع حفظ كل تغيير يجريه الوكيل تلقائيًا.' }
  , '只存保存点说明和操作记录，源码仍在项目中。': { 'zh-TW': '只存儲存點說明和操作記錄，原始碼仍在專案中。', en: 'Only checkpoint details and activity records are stored; your source code stays in the project.', ja: '保存ポイントの説明と操作記録だけを保存し、ソースコードはプロジェクトに残ります。', ko: '저장 지점 설명과 작업 기록만 저장되며 소스 코드는 프로젝트에 남아 있습니다.', ru: 'Хранятся только сведения о точках сохранения и журнал действий; исходный код остается в проекте.', ar: 'يتم حفظ تفاصيل نقاط الحفظ وسجل النشاط فقط؛ ويبقى الكود المصدري في المشروع.' }
  , '状态': { 'zh-TW': '狀態', en: 'Status', ja: '状態', ko: '상태', ru: 'Состояние', ar: 'الحالة' }
  , '记录位置': { 'zh-TW': '記錄位置', en: 'Record location', ja: '記録の場所', ko: '기록 위치', ru: 'Расположение записей', ar: 'موقع السجلات' }
  , '命令超时': { 'zh-TW': '命令逾時', en: 'Command timeout', ja: 'コマンドのタイムアウト', ko: '명령 시간 초과', ru: 'Тайм-аут команды', ar: 'مهلة الأمر' }
  , '通过统一事件 CLI 在修改前后创建保护点。': { 'zh-TW': '透過統一事件 CLI 在修改前後建立保護點。', en: 'Use the shared event CLI to create protection points before and after changes.', ja: '共通イベント CLI で変更前後に保護ポイントを作成します。', ko: '공통 이벤트 CLI로 변경 전후에 보호 지점을 만듭니다.', ru: 'Используйте единый CLI событий для создания точек защиты до и после изменений.', ar: 'استخدم واجهة سطر الأوامر الموحدة للأحداث لإنشاء نقاط حماية قبل التغييرات وبعدها.' }
  , '这些规则始终生效，不能被普通操作绕过。': { 'zh-TW': '這些規則始終生效，不能被一般操作繞過。', en: 'These rules are always active and cannot be bypassed through normal actions.', ja: 'これらのルールは常に有効で、通常の操作では回避できません。', ko: '이 규칙은 항상 적용되며 일반 작업으로 우회할 수 없습니다.', ru: 'Эти правила всегда действуют и не могут быть обойдены обычными действиями.', ar: 'هذه القواعد مفعلة دائمًا ولا يمكن تجاوزها بالإجراءات العادية.' }
  , '默认使用简体中文。选择会自动保存；阿拉伯语将采用从右到左的阅读方向。': { 'zh-TW': '預設使用簡體中文。選擇會自動儲存；阿拉伯語將採用由右至左的閱讀方向。', en: 'Simplified Chinese is the default. Your choice saves automatically; Arabic uses right-to-left reading direction.', ja: '既定は簡体中国語です。選択は自動保存され、アラビア語は右から左の方向で表示されます。', ko: '기본 언어는 중국어 간체이며 선택은 자동 저장됩니다. 아랍어는 오른쪽에서 왼쪽 방향을 사용합니다.', ru: 'По умолчанию используется упрощенный китайский. Выбор сохраняется автоматически; для арабского используется направление справа налево.', ar: 'الصينية المبسطة هي الإعداد الافتراضي. يتم حفظ اختيارك تلقائيًا؛ وتستخدم العربية اتجاه القراءة من اليمين إلى اليسار.' }
  , '选择保存保护记录、诊断日志和 VibeGit 专用 SSH 数据的本地文件夹。': { 'zh-TW': '選擇儲存保護記錄、診斷日誌和 VibeGit 專用 SSH 資料的本機資料夾。', en: 'Choose the local folder for protection records, diagnostic logs, and VibeGit SSH data.', ja: '保護記録、診断ログ、VibeGit 専用 SSH データを保存するローカルフォルダーを選びます。', ko: '보호 기록, 진단 로그 및 VibeGit 전용 SSH 데이터를 저장할 로컬 폴더를 선택합니다.', ru: 'Выберите локальную папку для записей защиты, диагностических журналов и данных SSH VibeGit.', ar: 'اختر المجلد المحلي لسجلات الحماية وسجلات التشخيص وبيانات SSH الخاصة بـ VibeGit.' }
  , '扫描 GitHub CLI、Codex 和 Claude Code。缺少 GitHub CLI 时会通过 Windows 包管理器自动安装。': { 'zh-TW': '掃描 GitHub CLI、Codex 和 Claude Code。缺少 GitHub CLI 時會透過 Windows 套件管理員自動安裝。', en: 'Check GitHub CLI, Codex, and Claude Code. If GitHub CLI is missing, Windows Package Manager installs it automatically.', ja: 'GitHub CLI、Codex、Claude Code を確認します。GitHub CLI がない場合は Windows パッケージ マネージャーで自動インストールします。', ko: 'GitHub CLI, Codex 및 Claude Code를 확인합니다. GitHub CLI가 없으면 Windows 패키지 관리자가 자동 설치합니다.', ru: 'Проверьте GitHub CLI, Codex и Claude Code. Если GitHub CLI отсутствует, диспетчер пакетов Windows установит его автоматически.', ar: 'تحقق من GitHub CLI وCodex وClaude Code. إذا لم يكن GitHub CLI موجودًا، فسيقوم مدير حزم Windows بتثبيته تلقائيًا.' }
  , '本地保存引擎正常': { 'zh-TW': '本機儲存引擎正常', en: 'Local save engine is ready', ja: 'ローカル保存エンジンは正常です', ko: '로컬 저장 엔진이 정상입니다', ru: 'Локальный движок сохранения готов', ar: 'محرك الحفظ المحلي جاهز' }
  , '未找到 Git': { 'zh-TW': '未找到 Git', en: 'Git not found', ja: 'Git が見つかりません', ko: 'Git을 찾을 수 없음', ru: 'Git не найден', ar: 'لم يتم العثور على Git' }
  , '状态检查失败': { 'zh-TW': '狀態檢查失敗', en: 'Status check failed', ja: '状態確認に失敗しました', ko: '상태 확인 실패', ru: 'Не удалось проверить состояние', ar: 'فشل فحص الحالة' }
  , '读取中…': { 'zh-TW': '讀取中…', en: 'Loading…', ja: '読み込み中…', ko: '불러오는 중…', ru: 'Загрузка…', ar: 'جارٍ التحميل…' }
  , '未连接': { 'zh-TW': '未連線', en: 'Not connected', ja: '未接続', ko: '연결되지 않음', ru: 'Не подключено', ar: 'غير متصل' }
  , '正在检测…': { 'zh-TW': '正在檢測…', en: 'Checking…', ja: '確認中…', ko: '확인 중…', ru: 'Проверка…', ar: 'جارٍ الفحص…' }
  , '未在 PATH 中检测到 Codex CLI': { 'zh-TW': '未在 PATH 中偵測到 Codex CLI', en: 'Codex CLI was not found in PATH', ja: 'PATH に Codex CLI が見つかりません', ko: 'PATH에서 Codex CLI를 찾지 못했습니다', ru: 'Codex CLI не найден в PATH', ar: 'لم يتم العثور على Codex CLI في PATH' }
  , '未在 PATH 中检测到 Claude Code': { 'zh-TW': '未在 PATH 中偵測到 Claude Code', en: 'Claude Code was not found in PATH', ja: 'PATH に Claude Code が見つかりません', ko: 'PATH에서 Claude Code를 찾지 못했습니다', ru: 'Claude Code не найден в PATH', ar: 'لم يتم العثور على Claude Code في PATH' }
  , '检测到 Codex；事件 CLI 模板可用': { 'zh-TW': '偵測到 Codex；事件 CLI 範本可用', en: 'Codex detected; event CLI template is available', ja: 'Codex を検出しました。イベント CLI テンプレートを利用できます', ko: 'Codex가 감지되었습니다. 이벤트 CLI 템플릿을 사용할 수 있습니다', ru: 'Codex обнаружен; доступен шаблон CLI событий', ar: 'تم اكتشاف Codex؛ قالب CLI للأحداث متاح' }
  , '检测到 Claude Code；事件 CLI 模板可用': { 'zh-TW': '偵測到 Claude Code；事件 CLI 範本可用', en: 'Claude Code detected; event CLI template is available', ja: 'Claude Code を検出しました。イベント CLI テンプレートを利用できます', ko: 'Claude Code가 감지되었습니다. 이벤트 CLI 템플릿을 사용할 수 있습니다', ru: 'Claude Code обнаружен; доступен шаблон CLI событий', ar: 'تم اكتشاف Claude Code؛ قالب CLI событий доступен' }
  , '回退前自动保险': { 'zh-TW': '回退前自動保險', en: 'Create a safety point before restore', ja: '復元前に安全ポイントを作成', ko: '복원 전 안전 지점 만들기', ru: 'Создавать страховочную точку перед восстановлением', ar: 'إنشاء نقطة أمان قبل الاستعادة' }
  , '不删除未跟踪文件': { 'zh-TW': '不刪除未追蹤檔案', en: 'Never delete untracked files', ja: '未追跡ファイルを削除しない', ko: '추적되지 않은 파일을 삭제하지 않음', ru: 'Не удалять неотслеживаемые файлы', ar: 'عدم حذف الملفات غير المتعقبة' }
  , '禁止强制推送': { 'zh-TW': '禁止強制推送', en: 'Block force pushes', ja: '強制プッシュを禁止', ko: '강제 푸시 차단', ru: 'Блокировать принудительные отправки', ar: 'حظر الدفع القسري' }
  , '上传前扫描敏感文件': { 'zh-TW': '上傳前掃描敏感檔案', en: 'Scan sensitive files before upload', ja: 'アップロード前に機密ファイルをスキャン', ko: '업로드 전 민감한 파일 검사', ru: 'Проверять конфиденциальные файлы перед отправкой', ar: 'فحص الملفات الحساسة قبل الرفع' }
  , 'Renderer 无文件系统权限': { 'zh-TW': 'Renderer 無檔案系統權限', en: 'Renderer has no file system access', ja: 'Renderer にファイルシステム権限はありません', ko: 'Renderer에 파일 시스템 권한이 없습니다', ru: 'У Renderer нет доступа к файловой системе', ar: 'لا يملك Renderer صلاحية الوصول إلى نظام الملفات' }
  , 'Git 命令有超时限制': { 'zh-TW': 'Git 命令有逾時限制', en: 'Git commands have a timeout limit', ja: 'Git コマンドにはタイムアウト制限があります', ko: 'Git 명령에는 시간 제한이 있습니다', ru: 'Для команд Git задано ограничение времени', ar: 'أوامر Git لها حد زمني' }
  , '源码只保存在你的电脑和你选择的 GitHub 仓库': { 'zh-TW': '原始碼只保存在你的電腦和你選擇的 GitHub 儲存庫', en: 'Source code stays only on your computer and in the GitHub repository you choose', ja: 'ソースコードはあなたのコンピューターと選択した GitHub リポジトリにのみ保存されます', ko: '소스 코드는 내 컴퓨터와 선택한 GitHub 저장소에만 보관됩니다', ru: 'Исходный код остается только на вашем компьютере и в выбранном репозитории GitHub', ar: 'يبقى الكود المصدري على جهازك وفي مستودع GitHub الذي تختاره فقط' }
  , '你的本地项目': { 'zh-TW': '你的本機專案', en: 'Your local projects', ja: 'ローカルプロジェクト', ko: '내 로컬 프로젝트', ru: 'Ваши локальные проекты', ar: 'مشاريعك المحلية' }
  , '每次 AI 修改，都能放心找回来。': { 'zh-TW': '每次 AI 修改，都能放心找回來。', en: 'Find your way back after every AI change.', ja: 'AI による変更も、いつでも安心して戻せます。', ko: 'AI가 수정할 때마다 안심하고 되돌릴 수 있습니다.', ru: 'После каждого изменения ИИ можно спокойно вернуться назад.', ar: 'يمكنك الرجوع بأمان بعد كل تغيير يجريه الذكاء الاصطناعي.' }
  , 'VibeGit 在本机保存可理解的版本，并在你允许时备份到 GitHub。': { 'zh-TW': 'VibeGit 在本機儲存易於理解的版本，並在你允許時備份到 GitHub。', en: 'VibeGit keeps understandable versions locally and backs them up to GitHub only when you allow it.', ja: 'VibeGit は分かりやすいバージョンをローカルに保存し、許可した場合のみ GitHub にバックアップします。', ko: 'VibeGit은 이해하기 쉬운 버전을 로컬에 보관하고 허용할 때만 GitHub에 백업합니다.', ru: 'VibeGit хранит понятные версии локально и делает резервную копию на GitHub только с вашего разрешения.', ar: 'يحتفظ VibeGit بإصدارات مفهومة محليًا ويجري نسخها احتياطيًا إلى GitHub فقط عندما تسمح بذلك.' }
  , '添加本地项目': { 'zh-TW': '新增本機專案', en: 'Add local project', ja: 'ローカルプロジェクトを追加', ko: '로컬 프로젝트 추가', ru: 'Добавить локальный проект', ar: 'إضافة مشروع محلي' }
  , '添加另一个项目': { 'zh-TW': '新增另一個專案', en: 'Add another project', ja: '別のプロジェクトを追加', ko: '다른 프로젝트 추가', ru: 'Добавить другой проект', ar: 'إضافة مشروع آخر' }
  , '选择本地文件夹': { 'zh-TW': '選擇本機資料夾', en: 'Choose a local folder', ja: 'ローカルフォルダーを選択', ko: '로컬 폴더 선택', ru: 'Выбрать локальную папку', ar: 'اختر مجلدًا محليًا' }
  , '尚未设置 GitHub 备份': { 'zh-TW': '尚未設定 GitHub 備份', en: 'GitHub backup not set up', ja: 'GitHub バックアップは未設定', ko: 'GitHub 백업이 설정되지 않음', ru: 'Резервное копирование GitHub не настроено', ar: 'لم يتم إعداد النسخ الاحتياطي على GitHub' }
  , '有尚未保存的修改': { 'zh-TW': '有尚未儲存的修改', en: 'Unsaved changes', ja: '未保存の変更があります', ko: '저장되지 않은 변경 사항', ru: 'Есть несохраненные изменения', ar: 'توجد تغييرات غير محفوظة' }
  , '管理项目备份': { 'zh-TW': '管理專案備份', en: 'Manage project backups', ja: 'プロジェクトのバックアップを管理', ko: '프로젝트 백업 관리', ru: 'Управление резервными копиями проектов', ar: 'إدارة النسخ الاحتياطية للمشاريع' }
  , '结束管理项目': { 'zh-TW': '結束管理專案', en: 'Finish managing projects', ja: 'プロジェクト管理を終了', ko: '프로젝트 관리 종료', ru: 'Завершить управление проектами', ar: 'إنهاء إدارة المشاريع' }
  , '删除本地备份': { 'zh-TW': '刪除本機備份', en: 'Delete local backup', ja: 'ローカルバックアップを削除', ko: '로컬 백업 삭제', ru: 'Удалить локальную резервную копию', ar: 'حذف النسخة الاحتياطية المحلية' }
  , '删除本地备份记录': { 'zh-TW': '刪除本機備份記錄', en: 'Delete local backup records', ja: 'ローカルバックアップ記録を削除', ko: '로컬 백업 기록 삭제', ru: 'Удалить локальные записи резервного копирования', ar: 'حذف سجلات النسخ الاحتياطية المحلية' }
  , '这会把该项目从 VibeGit 的项目列表中移除。': { 'zh-TW': '這會把該專案從 VibeGit 的專案清單中移除。', en: 'This removes the project from VibeGit’s project list.', ja: 'このプロジェクトを VibeGit のプロジェクト一覧から削除します。', ko: '이 프로젝트를 VibeGit 프로젝트 목록에서 제거합니다.', ru: 'Это удалит проект из списка проектов VibeGit.', ar: 'سيؤدي ذلك إلى إزالة المشروع من قائمة مشاريع VibeGit.' }
  , '将删除本地 VibeGit 保存点和操作记录': { 'zh-TW': '將刪除本機 VibeGit 儲存點和操作記錄', en: 'Local VibeGit checkpoints and activity history will be deleted', ja: 'ローカルの VibeGit 保存ポイントと操作履歴が削除されます', ko: '로컬 VibeGit 저장 지점과 작업 기록이 삭제됩니다', ru: 'Будут удалены локальные точки сохранения и история действий VibeGit', ar: 'سيتم حذف نقاط الحفظ المحلية وسجل النشاط في VibeGit' }
  , '不会删除你的项目文件、Git 仓库，也不会删除 GitHub 上已有的备份。': { 'zh-TW': '不會刪除你的專案檔案、Git 儲存庫，也不會刪除 GitHub 上已有的備份。', en: 'Your project files, Git repository, and existing GitHub backups will not be deleted.', ja: 'プロジェクトファイル、Git リポジトリ、既存の GitHub バックアップは削除されません。', ko: '프로젝트 파일, Git 저장소 및 기존 GitHub 백업은 삭제되지 않습니다.', ru: 'Ваши файлы проекта, репозиторий Git и существующие резервные копии GitHub удалены не будут.', ar: 'لن يتم حذف ملفات مشروعك أو مستودع Git أو النسخ الاحتياطية الموجودة على GitHub.' }
  , '我了解：这只会删除 VibeGit 的本地备份记录': { 'zh-TW': '我了解：這只會刪除 VibeGit 的本機備份記錄', en: 'I understand: this deletes only VibeGit local backup records', ja: '理解しました：VibeGit のローカルバックアップ記録のみを削除します', ko: '이해했습니다: VibeGit 로컬 백업 기록만 삭제됩니다', ru: 'Я понимаю: будут удалены только локальные записи резервного копирования VibeGit', ar: 'أفهم: سيؤدي هذا إلى حذف سجلات النسخ الاحتياطية المحلية لـ VibeGit فقط' }
  , '重命名保存点': { 'zh-TW': '重新命名儲存點', en: 'Rename checkpoint', ja: '保存ポイントの名前を変更', ko: '저장 지점 이름 바꾸기', ru: 'Переименовать точку сохранения', ar: 'إعادة تسمية نقطة الحفظ' }
  , '删除保存点': { 'zh-TW': '刪除儲存點', en: 'Delete checkpoint', ja: '保存ポイントを削除', ko: '저장 지점 삭제', ru: 'Удалить точку сохранения', ar: 'حذف نقطة الحفظ' }
  , '修改后的名称会用于时间线显示，不会改动项目文件或代码。': { 'zh-TW': '修改後的名稱會用於時間線顯示，不會改動專案檔案或程式碼。', en: 'The new name appears in the timeline and does not change project files or code.', ja: '新しい名前はタイムラインに表示され、プロジェクトのファイルやコードは変更されません。', ko: '새 이름은 타임라인에 표시되며 프로젝트 파일이나 코드를 변경하지 않습니다.', ru: 'Новое имя отображается на шкале времени и не меняет файлы или код проекта.', ar: 'يظهر الاسم الجديد في المخطط الزمني ولا يغير ملفات المشروع أو التعليمات البرمجية.' }
  , '保存点名称': { 'zh-TW': '儲存點名稱', en: 'Checkpoint name', ja: '保存ポイント名', ko: '저장 지점 이름', ru: 'Название точки сохранения', ar: 'اسم نقطة الحفظ' }
  , '保存名称': { 'zh-TW': '儲存名稱', en: 'Save name', ja: '名前を保存', ko: '이름 저장', ru: 'Сохранить имя', ar: 'حفظ الاسم' }
  , '请确认是否删除所选保存点。': { 'zh-TW': '請確認是否刪除所選儲存點。', en: 'Confirm whether to delete the selected checkpoint.', ja: '選択した保存ポイントを削除するか確認してください。', ko: '선택한 저장 지점을 삭제할지 확인하세요.', ru: 'Подтвердите удаление выбранной точки сохранения.', ar: 'يرجى تأكيد حذف نقطة الحفظ المحددة.' }
  , '此操作会移除这个本地保存点和它的 Git 记录。': { 'zh-TW': '此操作會移除這個本機儲存點及其 Git 記錄。', en: 'This removes this local checkpoint and its Git record.', ja: 'このローカル保存ポイントとその Git 記録を削除します。', ko: '이 로컬 저장 지점과 Git 기록을 제거합니다.', ru: 'Будут удалены эта локальная точка сохранения и её запись Git.', ar: 'سيؤدي ذلك إلى إزالة نقطة الحفظ المحلية هذه وسجل Git الخاص بها.' }
  , '项目文件、代码和其他保存点不会被删除。为保证可恢复性，VibeGit 会保留最后一个保存点。': { 'zh-TW': '專案檔案、程式碼和其他儲存點不會被刪除。為確保可還原性，VibeGit 會保留最後一個儲存點。', en: 'Project files, code, and other checkpoints are not deleted. VibeGit keeps the final checkpoint so the project remains recoverable.', ja: 'プロジェクトのファイル、コード、ほかの保存ポイントは削除されません。復元できるよう、VibeGit は最後の保存ポイントを残します。', ko: '프로젝트 파일, 코드, 다른 저장 지점은 삭제되지 않습니다. 복구를 위해 VibeGit은 마지막 저장 지점을 유지합니다.', ru: 'Файлы проекта, код и другие точки сохранения не удаляются. VibeGit сохраняет последнюю точку, чтобы проект можно было восстановить.', ar: 'لن يتم حذف ملفات المشروع أو الرمز أو نقاط الحفظ الأخرى. يحتفظ VibeGit بآخر نقطة حفظ حتى يظل المشروع قابلاً للاستعادة.' }
  , '我已了解，确认删除这个保存点': { 'zh-TW': '我已了解，確認刪除這個儲存點', en: 'I understand and confirm deleting this checkpoint', ja: '理解しました。この保存ポイントを削除します', ko: '이해했으며 이 저장 지점 삭제를 확인합니다', ru: 'Я понимаю и подтверждаю удаление этой точки сохранения', ar: 'أفهم وأؤكد حذف نقطة الحفظ هذه' }
  , '确认删除保存点': { 'zh-TW': '確認刪除儲存點', en: 'Confirm delete checkpoint', ja: '保存ポイントの削除を確認', ko: '저장 지점 삭제 확인', ru: 'Подтвердить удаление точки сохранения', ar: 'تأكيد حذف نقطة الحفظ' }
  , '已通过全盘扫描定位 Agent': { 'zh-TW': '已透過全磁碟掃描定位 Agent', en: 'An Agent was found through a full-disk scan', ja: '全ディスクスキャンで Agent が見つかりました', ko: '전체 디스크 검사에서 Agent를 찾았습니다', ru: 'Agent найден полным сканированием диска', ar: 'تم العثور على Agent عبر فحص كامل للقرص' }
}

function translateVisibleUi(language: DisplayLanguage): void {
  if (!document.body) return
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    if (!ORIGINAL_TEXT_BY_NODE.has(node) || RENDERED_TEXT_BY_NODE.get(node) !== node.data) ORIGINAL_TEXT_BY_NODE.set(node, node.data)
    const original = ORIGINAL_TEXT_BY_NODE.get(node) ?? node.data
    const translated = language === 'zh-CN' ? original : UI_TRANSLATIONS[original]?.[language]
    const checkpointCount = original.match(/^(\d+) 个保存点$/)
    const fileCount = original.match(/^(\d+) 个文件$/)
    const seconds = original.match(/^(\d+) 秒$/)
    const recentSave = original.match(/^最近保存 (.+)$/)
    const changedBy = original.match(/^由 (.+)$/)
    const removeBackup = original.match(/^删除 (.+) 的本地备份$/)
    const dynamicTranslation: Partial<Record<DisplayLanguage, string>> = checkpointCount ? {
      'zh-TW': `${checkpointCount[1]} 個儲存點`, en: `${checkpointCount[1]} checkpoints`, ja: `${checkpointCount[1]} 個の保存ポイント`, ko: `${checkpointCount[1]}개의 저장 지점`, ru: `${checkpointCount[1]} точек сохранения`, ar: `${checkpointCount[1]} نقاط حفظ`
    } : fileCount ? {
      'zh-TW': `${fileCount[1]} 個檔案`, en: `${fileCount[1]} files`, ja: `${fileCount[1]} 個のファイル`, ko: `${fileCount[1]}개 파일`, ru: `${fileCount[1]} файлов`, ar: `${fileCount[1]} ملفات`
    } : seconds ? {
      'zh-TW': `${seconds[1]} 秒`, en: `${seconds[1]} seconds`, ja: `${seconds[1]} 秒`, ko: `${seconds[1]}초`, ru: `${seconds[1]} сек.`, ar: `${seconds[1]} ثانية`
    } : recentSave ? {
      'zh-TW': `最近儲存 ${recentSave[1]}`, en: `Last saved ${recentSave[1]}`, ja: `最終保存 ${recentSave[1]}`, ko: `최근 저장 ${recentSave[1]}`, ru: `Последнее сохранение: ${recentSave[1]}`, ar: `آخر حفظ ${recentSave[1]}`
    } : changedBy ? {
      'zh-TW': `由 ${changedBy[1]}`, en: `by ${changedBy[1]}`, ja: `${changedBy[1]} による変更`, ko: `${changedBy[1]}의 변경`, ru: `изменено: ${changedBy[1]}`, ar: `بواسطة ${changedBy[1]}`
    } : removeBackup ? {
      'zh-TW': `刪除 ${removeBackup[1]} 的本機備份`, en: `Delete ${removeBackup[1]} local backup`, ja: `${removeBackup[1]} のローカルバックアップを削除`, ko: `${removeBackup[1]}의 로컬 백업 삭제`, ru: `Удалить локальную резервную копию ${removeBackup[1]}`, ar: `حذف النسخة الاحتياطية المحلية لـ ${removeBackup[1]}`
    } : {}
    const nextValue = translated ?? dynamicTranslation[language] ?? original
    if (node.data !== nextValue) node.data = nextValue
    RENDERED_TEXT_BY_NODE.set(node, nextValue)
  }
}

function isDisplayLanguage(value: string | null): value is DisplayLanguage {
  return DISPLAY_LANGUAGES.some((language) => language.value === value)
}

function savedDisplayLanguage(): DisplayLanguage {
  const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return isDisplayLanguage(saved) ? saved : 'zh-CN'
}

function savedChangePresentation(): ChangePresentation {
  return window.localStorage.getItem(CHANGE_PRESENTATION_STORAGE_KEY) === 'code' ? 'code' : 'feature'
}

function applyDisplayLanguage(displayLanguage: DisplayLanguage): void {
  const language = DISPLAY_LANGUAGES.find((option) => option.value === displayLanguage)!
  document.documentElement.lang = displayLanguage
  document.documentElement.dir = language.direction
}

class ApiError extends Error {
  constructor(readonly error: PublicError) {
    super(error.message)
  }
}

function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new ApiError(result.error)
  return result.data
}

function errorFrom(value: unknown): PublicError {
  if (value instanceof ApiError) return value.error
  return {
    code: 'UI_ERROR',
    message: value instanceof Error ? value.message : '操作没有完成',
    retryable: true
  }
}

function formatRelativeTime(value?: string): string {
  if (!value) return '还没有保存点'
  const delta = Date.now() - Date.parse(value)
  const locale = document.documentElement.lang || 'zh-CN'
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (delta < 60_000) return relative.format(0, 'second')
  if (delta < 3_600_000) return relative.format(-Math.floor(delta / 60_000), 'minute')
  if (delta < 86_400_000) return relative.format(-Math.floor(delta / 3_600_000), 'hour')
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function checkpointType(type: Checkpoint['type']): { label: string; tone: string } {
  const labels: Record<Checkpoint['type'], { label: string; tone: string }> = {
    initial: { label: '初始保护', tone: 'sage' },
    manual: { label: '手动保存', tone: 'blue' },
    pre_agent: { label: '修改前保护', tone: 'amber' },
    post_agent: { label: '功能保存', tone: 'violet' },
    pre_restore: { label: '回退前保险', tone: 'rose' },
    pre_sync: { label: '备份前保护', tone: 'sky' },
    stable: { label: '稳定版本', tone: 'green' }
  }
  return labels[type]
}

function agentLabel(agent: Checkpoint['agent']): string {
  return ({ codex: 'Codex', 'claude-code': 'Claude Code', manual: '你', system: 'VibeGit', unknown: '未知' })[agent]
}

function featureSummaryOf(checkpoint: Checkpoint): FeatureChangeSummary | undefined {
  const value = checkpoint.metadata.featureSummary
  if (!value || typeof value !== 'object') return undefined
  const summary = value as Partial<FeatureChangeSummary>
  const validItems = (items: unknown): string[] => Array.isArray(items) && items.every((item) => typeof item === 'string') ? items : []
  const result: FeatureChangeSummary = {
    ...(typeof summary.overview === 'string' ? { overview: summary.overview } : {}),
    added: validItems(summary.added),
    improved: validItems(summary.improved),
    removed: validItems(summary.removed)
  }
  return result.overview || result.added.length + result.improved.length + result.removed.length ? result : undefined
}

export function App(): ReactNode {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [agentEvents, setAgentEvents] = useState<AgentEventRecord[]>([])
  const [failedRestores, setFailedRestores] = useState<RestoreRecord[]>([])
  const [page, setPage] = useState<Page>('projects')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<PublicError>()
  const [notice, setNotice] = useState<{ message: string; restore?: RestoreRecord; tone?: 'success' | 'warning' }>()
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<Checkpoint>()
  const [diff, setDiff] = useState<CheckpointDiff>()
  const [diffLoading, setDiffLoading] = useState(false)
  const [modal, setModal] = useState<Modal>(null)
  const [displayLanguage, setDisplayLanguage] = useState<DisplayLanguage>(savedDisplayLanguage)
  const [changePresentation, setChangePresentation] = useState<ChangePresentation>(savedChangePresentation)

  useEffect(() => {
    applyDisplayLanguage(displayLanguage)
    translateVisibleUi(displayLanguage)
    const observer = new MutationObserver(() => translateVisibleUi(displayLanguage))
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [displayLanguage])

  useEffect(() => {
    const onLanguageChange = (event: Event): void => setDisplayLanguage((event as CustomEvent<DisplayLanguage>).detail)
    window.addEventListener('vibegit:language-change', onLanguageChange)
    return () => window.removeEventListener('vibegit:language-change', onLanguageChange)
  }, [])

  useEffect(() => {
    const onChangePresentation = (event: Event): void => setChangePresentation((event as CustomEvent<ChangePresentation>).detail)
    window.addEventListener('vibegit:change-presentation', onChangePresentation)
    return () => window.removeEventListener('vibegit:change-presentation', onChangePresentation)
  }, [])

  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedId), [projects, selectedId])

  const loadProjects = useCallback(async () => {
    const data = unwrap(await window.vibegit.listProjects())
    setProjects(data)
    return data
  }, [])

  const loadTimeline = useCallback(async (projectId: string) => {
    const [checkpointResult, agentEventResult, failedRestoreResult] = await Promise.all([
      window.vibegit.listCheckpoints(projectId),
      window.vibegit.listAgentEvents(projectId),
      window.vibegit.listFailedRestores(projectId)
    ])
    setCheckpoints(unwrap(checkpointResult))
    setAgentEvents(unwrap(agentEventResult))
    setFailedRestores(unwrap(failedRestoreResult))
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const data = await loadProjects()
        if (data[0]) setSelectedId(data[0].id)
      } catch (value) {
        setError(errorFrom(value))
      } finally {
        setLoading(false)
      }
    })()
  }, [loadProjects])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    void Promise.all([
      window.vibegit.listCheckpoints(selectedId),
      window.vibegit.listAgentEvents(selectedId),
      window.vibegit.listFailedRestores(selectedId)
    ])
      .then(([checkpointResult, agentEventResult, failedRestoreResult]) => {
        if (!active) return
        setCheckpoints(unwrap(checkpointResult))
        setAgentEvents(unwrap(agentEventResult))
        setFailedRestores(unwrap(failedRestoreResult))
      })
      .catch((value: unknown) => { if (active) setError(errorFrom(value)) })
    return () => { active = false }
  }, [selectedId])

  const addProjectPath = async (path: string): Promise<void> => {
    setBusy('add-project')
    setError(undefined)
    try {
      const project = unwrap(await window.vibegit.addProject({ path }))
      await loadProjects()
      setSelectedId(project.id)
      setPage('project')
      setModal(null)
      setNotice({ message: project.protectionEnabled ? '项目已添加' : '项目已添加，下一步开启版本保护' })
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const chooseProject = async (): Promise<void> => {
    setBusy('add-project')
    setError(undefined)
    try {
      const path = unwrap(await window.vibegit.selectProjectDirectory())
      if (!path) return
      await addProjectPath(path)
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const selectProject = (project: Project): void => {
    setSelectedId(project.id)
    setSelectedCheckpoint(undefined)
    setDiff(undefined)
    setPage('project')
  }

  const removeProject = async (project: Project): Promise<void> => {
    setBusy(`remove-${project.id}`)
    setError(undefined)
    try {
      const result = unwrap(await window.vibegit.removeProject(project.id))
      const remaining = await loadProjects()
      if (selectedId === project.id) {
        setSelectedCheckpoint(undefined)
        setDiff(undefined)
        setCheckpoints([])
        setAgentEvents([])
        setFailedRestores([])
        setSelectedId(remaining[0]?.id)
        setPage(remaining[0] ? 'project' : 'projects')
      }
      setModal(null)
      setNotice({ message: `已移除“${project.name}”的 ${result.removedCheckpoints} 个本地保存点；项目文件没有删除。` })
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const renameCheckpoint = async (checkpoint: Checkpoint, title: string): Promise<void> => {
    setBusy(`rename-${checkpoint.id}`)
    setError(undefined)
    try {
      const renamed = unwrap(await window.vibegit.renameCheckpoint(checkpoint.id, title))
      setSelectedCheckpoint((current) => current?.id === renamed.id ? renamed : current)
      setModal(null)
      await Promise.all([loadProjects(), loadTimeline(renamed.projectId)])
      setNotice({ message: `已将保存点重命名为“${renamed.title}”。` })
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const deleteCheckpoint = async (checkpoint: Checkpoint): Promise<void> => {
    setBusy(`delete-${checkpoint.id}`)
    setError(undefined)
    try {
      unwrap(await window.vibegit.deleteCheckpoint(checkpoint.id))
      if (selectedCheckpoint?.id === checkpoint.id) {
        setSelectedCheckpoint(undefined)
        setDiff(undefined)
      }
      setModal(null)
      await Promise.all([loadProjects(), loadTimeline(checkpoint.projectId)])
      setNotice({ message: `已删除保存点“${checkpoint.title}”；项目文件没有被删除。` })
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const initializeProtection = async (): Promise<void> => {
    if (!selectedProject) return
    setBusy('initialize')
    setError(undefined)
    try {
      unwrap(await window.vibegit.initializeProtection(selectedProject.id))
      await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
      setNotice({ message: '版本保护已开启，初始保存点创建成功' })
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const refreshProject = async (): Promise<void> => {
    if (!selectedProject) return
    setBusy('refresh')
    try {
      unwrap(await window.vibegit.refreshProject(selectedProject.id))
      await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const openCheckpoint = async (checkpoint: Checkpoint): Promise<void> => {
    setSelectedCheckpoint(checkpoint)
    setDiff(undefined)
    setDiffLoading(true)
    try { setDiff(unwrap(await window.vibegit.getCheckpointDiff(checkpoint.id))) }
    catch (value) { setError(errorFrom(value)) }
    finally { setDiffLoading(false) }
  }

  const prepareRestore = async (checkpoint: Checkpoint): Promise<void> => {
    if (!selectedProject) return
    setBusy(`restore-${checkpoint.id}`)
    setError(undefined)
    try {
      const preview = unwrap(await window.vibegit.prepareRestore(selectedProject.id, checkpoint.id))
      setModal({ kind: 'restore', preview, checkpoint })
      await loadTimeline(selectedProject.id)
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  const executeRestore = async (preview: RestorePreview): Promise<void> => {
    if (!selectedProject) return
    setBusy('execute-restore')
    try {
      const restore = unwrap(await window.vibegit.executeRestore(preview.token))
      setModal(null)
      setNotice({ message: '已回到所选版本；回退前内容仍可找回', restore })
      await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
    } catch (value) {
      setError(errorFrom(value))
      setModal(null)
      try {
        const failed = unwrap(await window.vibegit.failedRestoreForToken(preview.token))
        if (failed?.recoveryDirectory) {
          setNotice({
            message: '回退未完整执行；回退前保险点仍在，如有已移动的文件可从恢复区取回',
            restore: failed,
            tone: 'warning'
          })
        }
      } catch { /* Keep the original restore error visible. */ }
    } finally {
      setBusy(undefined)
    }
  }

  const undoRestore = async (restore: RestoreRecord): Promise<void> => {
    if (!selectedProject) return
    setBusy('undo-restore')
    try {
      unwrap(await window.vibegit.undoRestore(restore.id))
      setNotice({ message: '已撤销本次回退，文件恢复到回退前状态' })
      await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
    } catch (value) {
      setError(errorFrom(value))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div className="app-frame">
      <AppTitleBar />
      <div className="app-shell">
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        page={page}
        busy={busy}
        onSelect={selectProject}
        onAdd={() => void chooseProject()}
        onRemove={(project) => setModal({ kind: 'remove-project', project })}
        onProjects={() => setPage('projects')}
        onSettings={() => setPage('settings')}
      />
      <main className="main-area">
        {notice && (
          <div className={`toast ${notice.tone === 'warning' ? 'toast-warning' : 'toast-success'}`} role="status">
            {notice.tone === 'warning' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            <span>{notice.message}</span>
            {notice.restore?.status === 'completed' && <button onClick={() => void undoRestore(notice.restore!)} disabled={Boolean(busy)}><Undo2 size={15} />撤销本次回退</button>}
            {notice.restore?.recoveryDirectory && <button onClick={() => void window.vibegit.openRecoveryDirectory(notice.restore!.id)}><FolderOpen size={15} />打开恢复区</button>}
            <button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(undefined)}><X size={16} /></button>
          </div>
        )}
        {error && <ErrorBanner error={error} onClose={() => setError(undefined)} />}
        {loading ? (
          <LoadingView label="正在读取项目保护状态…" />
        ) : page === 'settings' ? (
          <>
            <SettingsView onBack={() => setPage(selectedProject ? 'project' : 'projects')} />
            <LanguagePreferences />
            <ChangePresentationPreferences />
            <DataDirectoryPreferences />
            <EnvironmentPreferences />
          </>
        ) : page === 'projects' || !selectedProject ? (
          <ProjectsHome projects={projects} busy={busy} onAdd={() => void chooseProject()} onSelect={selectProject} />
        ) : (
          <ProjectWorkspace
            project={selectedProject}
            checkpoints={checkpoints}
            agentEvents={agentEvents}
            failedRestores={failedRestores}
            changePresentation={changePresentation}
            busy={busy}
            onInitialize={() => void initializeProtection()}
            onRefresh={() => void refreshProject()}
            onSave={() => setModal({ kind: 'save' })}
            onShelf={() => setModal({ kind: 'shelf' })}
            onBackup={() => setModal({ kind: 'backup' })}
            onOpenCheckpoint={(checkpoint) => void openCheckpoint(checkpoint)}
            onRenameCheckpoint={(checkpoint) => setModal({ kind: 'rename-checkpoint', checkpoint })}
            onDeleteCheckpoint={(checkpoint) => setModal({ kind: 'delete-checkpoint', checkpoint })}
          />
        )}
      </main>

      {selectedCheckpoint && (
        <CheckpointDrawer
          checkpoint={selectedCheckpoint}
          diff={diff}
          loading={diffLoading}
          busy={busy}
          changePresentation={changePresentation}
          onClose={() => { setSelectedCheckpoint(undefined); setDiff(undefined) }}
          onRestore={() => void prepareRestore(selectedCheckpoint)}
        />
      )}
      {modal?.kind === 'save' && selectedProject && (
        <SaveModal
          project={selectedProject}
          busy={busy === 'save'}
          onClose={() => setModal(null)}
          onSave={async (title, stable, note) => {
            setBusy('save')
            try {
              unwrap(await window.vibegit.createCheckpoint({
                projectId: selectedProject.id,
                type: stable ? 'stable' : 'manual',
                title,
                agent: 'manual',
                isStable: stable,
                ...(note ? { note } : {})
              }))
              setModal(null)
              setNotice({ message: '当前版本已安全保存' })
              await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
            } catch (value) { setError(errorFrom(value)) }
            finally { setBusy(undefined) }
          }}
        />
      )}
      {modal?.kind === 'restore' && (
        <RestoreModal
          preview={modal.preview}
          checkpoint={modal.checkpoint}
          busy={busy === 'execute-restore'}
          onClose={() => setModal(null)}
          onConfirm={() => void executeRestore(modal.preview)}
        />
      )}
      {modal?.kind === 'shelf' && selectedProject && (
        <ShelfModal
          project={selectedProject}
          onClose={() => setModal(null)}
          onChanged={async (message) => {
            await Promise.all([loadProjects(), loadTimeline(selectedProject.id)])
            setNotice({ message })
          }}
          onError={(value) => setError(errorFrom(value))}
        />
      )}
      {modal?.kind === 'backup' && selectedProject && (
        <BackupModal
          project={selectedProject}
          onClose={() => setModal(null)}
          onProjectChange={async () => {
            await loadProjects()
          }}
          onSuccess={(message) => setNotice({ message })}
          onError={(value) => setError(errorFrom(value))}
        />
      )}
      {modal?.kind === 'remove-project' && (
        <RemoveProjectModal
          project={modal.project}
          busy={busy === `remove-${modal.project.id}`}
          onClose={() => setModal(null)}
          onConfirm={() => void removeProject(modal.project)}
        />
      )}
      {modal?.kind === 'rename-checkpoint' && (
        <RenameCheckpointModal
          checkpoint={modal.checkpoint}
          busy={busy === `rename-${modal.checkpoint.id}`}
          onClose={() => setModal(null)}
          onConfirm={(title) => void renameCheckpoint(modal.checkpoint, title)}
        />
      )}
      {modal?.kind === 'delete-checkpoint' && (
        <DeleteCheckpointModal
          checkpoint={modal.checkpoint}
          busy={busy === `delete-${modal.checkpoint.id}`}
          onClose={() => setModal(null)}
          onConfirm={() => void deleteCheckpoint(modal.checkpoint)}
        />
      )}
      </div>
    </div>
  )
}

function AppTitleBar(): ReactNode {
  return <header className="app-titlebar" onDoubleClick={() => void window.vibegit.toggleMaximizeWindow()}>
    <div className="app-titlebar-brand"><img src={appLogo} alt="" /><span>VibeGit</span></div>
    <div className="window-controls">
      <button aria-label="最小化窗口" onClick={() => void window.vibegit.minimizeWindow()}><Minus size={17} /></button>
      <button aria-label="最大化或还原窗口" onClick={() => void window.vibegit.toggleMaximizeWindow()}><Maximize2 size={15} /></button>
      <button className="window-close" aria-label="关闭窗口" onClick={() => void window.vibegit.closeWindow()}><X size={17} /></button>
    </div>
  </header>
}

function Sidebar(props: {
  projects: Project[]
  selectedId?: string | undefined
  page: Page
  busy?: string | undefined
  onSelect(project: Project): void
  onAdd(): void
  onRemove(project: Project): void
  onProjects(): void
  onSettings(): void
}): ReactNode {
  const [managingProjects, setManagingProjects] = useState(false)
  return (
    <aside className="sidebar">
      <nav className="primary-nav" aria-label="主导航">
        <button className={props.page === 'projects' ? 'active' : ''} onClick={props.onProjects}><FolderHeart size={17} />所有项目</button>
      </nav>
      <div className="sidebar-section-title"><span>最近项目</span><span className="sidebar-section-actions"><button aria-label="添加项目" onClick={props.onAdd}><Plus size={15} /></button><button aria-label={managingProjects ? '结束管理项目' : '管理项目备份'} disabled={props.projects.length === 0} className={managingProjects ? 'active' : ''} onClick={() => setManagingProjects((current) => !current)}><Minus size={15} /></button></span></div>
      <div className="project-nav-list">
        {props.projects.length === 0 ? <p className="sidebar-empty">添加第一个项目后，它会出现在这里。</p> : props.projects.map((project) => (
          <div className={`project-nav-row ${props.selectedId === project.id && props.page === 'project' ? 'active' : ''} ${managingProjects ? 'managing' : ''}`} key={project.id}>
            <button className="project-nav-main" onClick={() => props.onSelect(project)}>
              <span className={`project-dot ${project.hasUnsavedChanges ? 'unsaved' : 'safe'}`} />
              <span className="project-nav-copy"><strong>{project.name}</strong><small>{project.hasUnsavedChanges ? '有尚未保存的修改' : '当前版本已保存'}</small></span>
            </button>
            {managingProjects && <button className="project-remove-button" aria-label={`删除 ${project.name} 的本地备份`} title="删除本地备份" onClick={() => props.onRemove(project)}><Trash2 size={14} /></button>}
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className={props.page === 'settings' ? 'active' : ''} onClick={props.onSettings}><Settings size={17} />设置与连接</button>
        <div className="safety-note"><LockKeyhole size={15} /><span>源码只保存在你的电脑和你选择的 GitHub 仓库</span></div>
      </div>
    </aside>
  )
}

function ProjectsHome(props: { projects: Project[]; busy?: string | undefined; onAdd(): void; onSelect(project: Project): void }): ReactNode {
  return (
    <section className="page projects-page">
      <header className="page-header">
        <div><p className="eyebrow">你的本地项目</p><h1>每次 AI 修改，都能放心找回来。</h1><p>VibeGit 在本机保存可理解的版本，并在你允许时备份到 GitHub。</p></div>
        <button className="button primary" onClick={props.onAdd} disabled={props.busy === 'add-project'}>
          {props.busy === 'add-project' ? <LoaderCircle className="spin" size={17} /> : <FolderOpen size={17} />}添加本地项目
        </button>
      </header>
      {props.projects.length === 0 ? (
        <div className="welcome-card">
          <div className="welcome-visual"><img className="welcome-app-logo" src={appLogo} alt="" /><Sparkles size={22} /></div>
          <div><span className="pill neutral">首次使用</span><h2>先选择一个正在用 AI 开发的文件夹</h2><p>我们不会上传或删除文件。开启保护后，会为当前状态建立第一个保存点。</p>
            <button className="button primary large" onClick={props.onAdd}><FolderOpen size={18} />选择项目文件夹</button>
          </div>
          <ol className="welcome-steps"><li><span>1</span>添加项目</li><li><span>2</span>开启版本保护</li><li><span>3</span>放心让 Agent 修改</li></ol>
        </div>
      ) : (
        <div className="project-grid">
          {props.projects.map((project) => <ProjectCard key={project.id} project={project} onClick={() => props.onSelect(project)} />)}
          <button className="add-project-card" onClick={props.onAdd}><Plus size={22} /><strong>添加另一个项目</strong><span>选择本地文件夹</span></button>
        </div>
      )}
    </section>
  )
}

function ProjectCard({ project, onClick }: { project: Project; onClick(): void }): ReactNode {
  return (
    <button className="project-card" onClick={onClick}>
      <div className="project-card-top"><span className="folder-icon"><FolderHeart size={21} /></span><ChevronRight size={18} /></div>
      <h3>{project.name}</h3><p className="path-text" title={project.path}>{project.path}</p>
      <div className="project-card-status">
        <span className={`status-line ${project.hasUnsavedChanges ? 'warning' : 'safe'}`}>{project.hasUnsavedChanges ? <Clock3 size={15} /> : <CheckCircle2 size={15} />}{project.hasUnsavedChanges ? '有尚未保存的修改' : '当前版本已保存'}</span>
        <span className="status-line muted"><Cloud size={15} />{project.githubSyncStatus === 'synced' ? '已备份到 GitHub' : project.githubRemoteUrl ? '有尚未备份的保存点' : '尚未设置 GitHub 备份'}</span>
      </div>
      <div className="project-card-meta"><span>最近保存 {formatRelativeTime(project.lastCheckpointAt)}</span><span>{project.lastAgent ? `由 ${agentLabel(project.lastAgent)}` : '尚无 Agent 记录'}</span></div>
    </button>
  )
}

function ProjectWorkspace(props: {
  project: Project
  checkpoints: Checkpoint[]
  agentEvents: AgentEventRecord[]
  failedRestores: RestoreRecord[]
  changePresentation: ChangePresentation
  busy?: string | undefined
  onInitialize(): void
  onRefresh(): void
  onSave(): void
  onShelf(): void
  onBackup(): void
  onOpenCheckpoint(checkpoint: Checkpoint): void
  onRenameCheckpoint(checkpoint: Checkpoint): void
  onDeleteCheckpoint(checkpoint: Checkpoint): void
}): ReactNode {
  const { project } = props
  const latestNoChange = props.agentEvents.find((event) => event.event === 'task-end' && !event.checkpointId)
  return (
    <section className="page workspace-page">
      <header className="workspace-header">
        <div className="workspace-title"><span className="folder-icon large"><FolderHeart size={23} /></span><div><div className="title-row"><h1>{project.name}</h1>{project.protectionEnabled && <span className="pill safe"><ShieldCheck size={13} />保护中</span>}</div><p title={project.path}>{project.path}</p></div></div>
        <div className="header-actions">
          <button className="button ghost" aria-label="刷新项目状态" onClick={props.onRefresh} disabled={props.busy === 'refresh'}><RefreshCw className={props.busy === 'refresh' ? 'spin' : ''} size={16} /></button>
          <button className="button ghost" onClick={props.onShelf} disabled={!project.protectionEnabled}><Archive size={16} />暂时收起</button>
          <button className="button secondary" onClick={props.onBackup}><Cloud size={16} />GitHub 备份</button>
          <button className="button primary" onClick={props.onSave} disabled={!project.protectionEnabled}><Save size={16} />创建保存点</button>
        </div>
      </header>

      {!project.protectionEnabled ? (
        <div className="protection-setup">
          <div className="protection-icon"><Shield size={34} /></div>
          <div><span className="pill warning">尚未保护</span><h2>为这个项目开启版本保护</h2><p>VibeGit 会初始化本地版本记录并创建初始保存点，不会上传文件，也不会改变你的工作方式。</p>
            <div className="setup-guarantees"><span><Check size={15} />文件安全不丢失</span><span><Check size={15} />Git 操作一键完成</span><span><Check size={15} />修改记录随时回退</span></div>
            <button className="button primary large" onClick={props.onInitialize} disabled={props.busy === 'initialize'}>{props.busy === 'initialize' ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}开启版本保护</button>
          </div>
        </div>
      ) : (
        <>
          <div className="status-strip">
            <div className={project.hasUnsavedChanges ? 'status-card amber' : 'status-card green'}>{project.hasUnsavedChanges ? <Clock3 size={20} /> : <ShieldCheck size={20} />}<span><strong>{project.hasUnsavedChanges ? '有新的修改' : '当前版本已保存'}</strong><small>{project.hasUnsavedChanges ? '建议在继续让 AI 修改前创建保存点' : `最近保存 ${formatRelativeTime(project.lastCheckpointAt)}`}</small></span></div>
            <div className="status-card neutral"><Sparkles size={20} /><span><strong>{project.lastAgent ? agentLabel(project.lastAgent) : 'Agent 尚未连接'}</strong><small>{project.lastAgent ? '最近修改来源' : '可在设置中查看连接方法'}</small></span></div>
            <button className="status-card neutral clickable" onClick={props.onBackup}><Cloud size={20} /><span><strong>{project.githubSyncStatus === 'synced' ? '已安全备份' : project.githubRemoteUrl ? '等待备份' : '尚未设置备份'}</strong><small>{project.githubSyncStatus === 'synced' ? formatRelativeTime(project.lastSyncedAt) : '备份到你的 GitHub 私有仓库'}</small></span><ChevronRight size={17} /></button>
          </div>
          <div className="timeline-layout">
            <div className="timeline-heading"><div><p className="eyebrow">项目时间线</p><h2>你的安全保存记录</h2></div><span>{props.checkpoints.length} 个保存点</span></div>
            {latestNoChange && <div className="agent-no-change" role="status"><CheckCircle2 size={17} /><div><strong>任务完成，但没有检测到文件变化</strong><small>{agentLabel(latestNoChange.agent)}{latestNoChange.taskText ? `：${latestNoChange.taskText}` : ' 本轮没有需要保存的新文件内容。'}</small></div></div>}
            {props.failedRestores.map((restore) => <div className="restore-recovery-alert" key={restore.id} role="alert"><AlertTriangle size={18} /><div><strong>有一次未完成的回退需要留意</strong><small>保险点仍在；如有已移动的文件，它们保存在恢复区，可随时打开查看。</small></div><button className="button ghost" onClick={() => void window.vibegit.openRecoveryDirectory(restore.id)}><FolderOpen size={15} />打开恢复区</button></div>)}
            {props.checkpoints.length === 0 ? <EmptyTimeline onSave={props.onSave} /> : <Timeline checkpoints={props.checkpoints} changePresentation={props.changePresentation} onOpen={props.onOpenCheckpoint} onRename={props.onRenameCheckpoint} onDelete={props.onDeleteCheckpoint} />}
          </div>
        </>
      )}
    </section>
  )
}

function Timeline({ checkpoints, changePresentation, onOpen, onRename, onDelete }: { checkpoints: Checkpoint[]; changePresentation: ChangePresentation; onOpen(checkpoint: Checkpoint): void; onRename(checkpoint: Checkpoint): void; onDelete(checkpoint: Checkpoint): void }): ReactNode {
  return (
    <div className="timeline">
      {checkpoints.map((checkpoint, index) => {
        const type = checkpointType(checkpoint.type)
        return (
          <article className="timeline-item" key={checkpoint.id}>
            <div className="timeline-rail"><span className={`timeline-node ${type.tone}`}>{checkpoint.type === 'post_agent' ? <Sparkles size={15} /> : checkpoint.type === 'pre_restore' ? <ShieldAlert size={15} /> : <Save size={15} />}</span>{index < checkpoints.length - 1 && <i />}</div>
            <div className="timeline-card">
              <button className="timeline-card-open" onClick={() => onOpen(checkpoint)}>
                <div className="timeline-card-title"><div><h3>{checkpoint.title}</h3><span className={`pill ${type.tone}`}>{type.label}</span></div></div>
                {checkpoint.taskText && <p className="task-text">“{checkpoint.taskText}”</p>}
                {changePresentation === 'feature' && featureSummaryOf(checkpoint)?.overview && <p className="feature-summary-preview">{featureSummaryOf(checkpoint)!.overview}</p>}
                <div className="timeline-meta"><span><Sparkles size={14} />{agentLabel(checkpoint.agent)}</span><span><Clock3 size={14} />{formatRelativeTime(checkpoint.createdAt)}</span><span><FileCode2 size={14} />{checkpoint.changedFiles.length} 个文件</span><span className="changes"><b>+{checkpoint.insertions}</b><em>−{checkpoint.deletions}</em></span></div>
                <div className="timeline-footer"><span className={checkpoint.testStatus === 'passed' ? 'good' : 'muted'}>{checkpoint.testStatus === 'passed' ? '测试通过' : checkpoint.testStatus === 'failed' ? '测试未通过' : '未关联测试'}</span><span className={checkpoint.githubSyncStatus === 'synced' ? 'good' : 'muted'}>{checkpoint.githubSyncStatus === 'synced' ? '已备份' : '仅保存在本机'}</span><span className="link-copy">{changePresentation === 'feature' ? '查看功能变化' : '查看代码变更'} <ChevronRight size={14} /></span></div>
              </button>
              <CheckpointActions checkpoint={checkpoint} onRename={onRename} onDelete={onDelete} />
            </div>
          </article>
        )
      })}
    </div>
  )
}

function CheckpointActions({ checkpoint, onRename, onDelete }: { checkpoint: Checkpoint; onRename(checkpoint: Checkpoint): void; onDelete(checkpoint: Checkpoint): void }): ReactNode {
  const [open, setOpen] = useState(false)
  return <div className="checkpoint-actions">
    <button className="checkpoint-menu-trigger" aria-label="打开保存点操作菜单" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}><MoreHorizontal size={18} /></button>
    {open && <div className="checkpoint-menu" role="menu" aria-label={`${checkpoint.title} 的操作`}>
      <button role="menuitem" onClick={() => { setOpen(false); onRename(checkpoint) }}><Pencil size={15} />重命名保存点</button>
      <button className="danger" role="menuitem" onClick={() => { setOpen(false); onDelete(checkpoint) }}><Trash2 size={15} />删除保存点</button>
    </div>}
  </div>
}

function EmptyTimeline({ onSave }: { onSave(): void }): ReactNode {
  return <div className="empty-state"><History size={32} /><h3>时间线还很安静</h3><p>创建保存点后，你会在这里看到每轮修改和恢复记录。</p><button className="button secondary" onClick={onSave}><Save size={16} />创建第一个保存点</button></div>
}

function FeatureChangeView({ checkpoint }: { checkpoint: Checkpoint }): ReactNode {
  const summary = featureSummaryOf(checkpoint)
  if (!summary) {
    return <div className="feature-summary-empty"><Sparkles size={25} /><strong>这次还没有功能说明</strong><span>让 Codex 或 Claude Code 在完成任务后使用 VibeGit 的改动说明技能；下一次保存点会显示大白话总结。</span></div>
  }
  const sections: Array<{ label: string; items: string[]; tone: string }> = [
    { label: '新增了什么', items: summary.added, tone: 'added' },
    { label: '改进了什么', items: summary.improved, tone: 'improved' },
    { label: '删除了什么', items: summary.removed, tone: 'removed' }
  ]
  return <div className="feature-change-view">
    <div className="feature-summary-overview"><Sparkles size={18} /><div><strong>这次的功能变化</strong>{summary.overview && <p>{summary.overview}</p>}</div></div>
    <div className="feature-change-sections">
      {sections.filter((section) => section.items.length > 0).map((section) => <section className={`feature-change-section ${section.tone}`} key={section.label}><h3>{section.label}</h3><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></section>)}
    </div>
  </div>
}

function CheckpointDrawer(props: { checkpoint: Checkpoint; diff?: CheckpointDiff | undefined; loading: boolean; busy?: string | undefined; changePresentation: ChangePresentation; onClose(): void; onRestore(): void }): ReactNode {
  const [activeFile, setActiveFile] = useState<string>()
  const current = props.diff?.files.find((file) => file.path === activeFile) ?? props.diff?.files[0]
  const type = checkpointType(props.checkpoint.type)
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose() }}>
      <aside className="checkpoint-drawer" aria-label="保存点详情">
        <header className="drawer-header"><button className="icon-button" aria-label="关闭详情" onClick={props.onClose}><X size={18} /></button><div><span className={`pill ${type.tone}`}>{type.label}</span><h2>{props.checkpoint.title}</h2><p>{new Intl.DateTimeFormat(document.documentElement.lang || 'zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(props.checkpoint.createdAt))} · {agentLabel(props.checkpoint.agent)}</p></div><button className="button danger-soft" onClick={props.onRestore} disabled={props.busy === `restore-${props.checkpoint.id}`}><RotateCcw size={16} />回到这个版本</button></header>
        {props.checkpoint.taskText && <div className="task-summary"><Sparkles size={17} /><div><strong>当时交给 Agent 的任务</strong><p>{props.checkpoint.taskText}</p></div></div>}
        <div className="diff-summary"><span><FileCode2 size={16} />{props.checkpoint.changedFiles.length} 个文件</span><b>+{props.checkpoint.insertions}</b><em>−{props.checkpoint.deletions}</em></div>
        {props.changePresentation === 'feature' ? <FeatureChangeView checkpoint={props.checkpoint} /> : props.loading ? <LoadingView label="正在整理这次修改…" compact /> : !props.diff || props.diff.files.length === 0 ? <div className="empty-diff"><CheckCircle2 size={26} /><strong>这个保存点没有文件内容变化</strong><span>它用于记录一个安全边界。</span></div> : (
          <div className="diff-workspace">
            <div className="file-list" role="listbox" aria-label="修改的文件">{props.diff.files.map((file) => <button key={file.path} className={(current?.path === file.path) ? 'active' : ''} onClick={() => setActiveFile(file.path)}><FileCode2 size={15} /><span>{file.path}</span><small className={file.kind}>{file.kind === 'added' ? '新增' : file.kind === 'deleted' ? '删除' : file.kind === 'renamed' ? '改名' : '修改'}</small></button>)}</div>
            <div className="patch-panel">{current && <><div className="patch-header"><span>{current.path}</span><span><b>+{current.insertions}</b> <em>−{current.deletions}</em></span></div>{current.binary ? <div className="binary-note">这是二进制文件，无法显示逐行差异。</div> : <PatchView patch={current.patch} />}</>}</div>
          </div>
        )}
      </aside>
    </div>
  )
}

function PatchView({ patch }: { patch: string }): ReactNode {
  if (!patch) return <div className="empty-diff"><Check size={22} /><span>没有可显示的文本差异</span></div>
  const lines = patch.split('\n').filter((line) =>
    !line.startsWith('diff --git ') &&
    !line.startsWith('index ') &&
    !line.startsWith('new file mode ') &&
    !line.startsWith('deleted file mode ') &&
    !line.startsWith('similarity index ') &&
    !line.startsWith('rename from ') &&
    !line.startsWith('rename to ') &&
    !line.startsWith('--- ') &&
    !line.startsWith('+++ ') &&
    !line.startsWith('@@ ')
  )
  return <pre className="patch-view">{lines.map((line, index) => <span key={`${index}-${line.slice(0, 8)}`} className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''}><i>{index + 1}</i><code>{line || ' '}</code></span>)}</pre>
}

function SaveModal(props: { project: Project; busy: boolean; onClose(): void; onSave(title: string, stable: boolean, note?: string): Promise<void> }): ReactNode {
  const [title, setTitle] = useState('当前可用版本')
  const [stable, setStable] = useState(false)
  const [note, setNote] = useState('')
  const submit = (event: FormEvent): void => { event.preventDefault(); if (title.trim()) void props.onSave(title.trim(), stable, note.trim() || undefined) }
  return <ModalFrame title="创建保存点" subtitle={`保存 ${props.project.name} 的当前状态，文件会继续留在原处。`} onClose={props.onClose}>
    <form onSubmit={submit} className="modal-form"><label>给这个版本一个容易记住的名字<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="例如：邮箱验证码登录完成" /></label><label>备注（可选）<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="记录为什么保存这个版本" /></label><label className="check-row"><input type="checkbox" checked={stable} onChange={(event) => setStable(event.target.checked)} /><span><strong>标记为稳定版本</strong><small>表示这是你确认可以正常使用的版本</small></span></label><div className="modal-actions"><button type="button" className="button ghost" onClick={props.onClose}>取消</button><button className="button primary" disabled={props.busy || !title.trim()}>{props.busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存当前版本</button></div></form>
  </ModalFrame>
}

function RenameCheckpointModal(props: { checkpoint: Checkpoint; busy: boolean; onClose(): void; onConfirm(title: string): void }): ReactNode {
  const [title, setTitle] = useState(props.checkpoint.title)
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (title.trim()) props.onConfirm(title.trim())
  }
  return <ModalFrame title="重命名保存点" subtitle="修改后的名称会用于时间线显示，不会改动项目文件或代码。" onClose={props.onClose}>
    <form className="checkpoint-name-form" onSubmit={submit}>
      <label>保存点名称<input aria-label="保存点名称" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} autoFocus /></label>
      <div className="modal-actions"><button type="button" className="button ghost" onClick={props.onClose}>取消</button><button className="button primary" disabled={!title.trim() || props.busy}>{props.busy ? <LoaderCircle className="spin" size={16} /> : <Pencil size={16} />}保存名称</button></div>
    </form>
  </ModalFrame>
}

function DeleteCheckpointModal(props: { checkpoint: Checkpoint; busy: boolean; onClose(): void; onConfirm(): void }): ReactNode {
  const [confirmed, setConfirmed] = useState(false)
  return <ModalFrame danger title="删除保存点" subtitle="请确认是否删除所选保存点。" onClose={props.onClose}>
    <div className="checkpoint-delete-content"><div className="remove-project-warning"><Trash2 size={20} /><div><strong>此操作会移除这个本地保存点和它的 Git 记录。</strong><p>项目文件、代码和其他保存点不会被删除。为保证可恢复性，VibeGit 会保留最后一个保存点。</p></div></div><label className="confirm-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我已了解，确认删除这个保存点</label><div className="modal-actions"><button className="button ghost" onClick={props.onClose}>取消</button><button className="button danger" disabled={!confirmed || props.busy} onClick={props.onConfirm}>{props.busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}确认删除保存点</button></div></div>
  </ModalFrame>
}

function RemoveProjectModal(props: { project: Project; busy: boolean; onClose(): void; onConfirm(): void }): ReactNode {
  const [confirmed, setConfirmed] = useState(false)
  return <ModalFrame danger title={`移除“${props.project.name}”的备份？`} subtitle="这会把该项目从 VibeGit 的项目列表中移除。" onClose={props.onClose}>
    <div className="remove-project-warning"><ShieldAlert size={20} /><div><strong>将删除本地 VibeGit 保存点和操作记录</strong><p>不会删除你的项目文件、Git 仓库，也不会删除 GitHub 上已有的备份。</p></div></div>
    <label className="confirm-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我了解：这只会删除 VibeGit 的本地备份记录</label>
    <div className="modal-actions"><button className="button ghost" onClick={props.onClose} disabled={props.busy}>取消</button><button className="button danger" disabled={!confirmed || props.busy} onClick={props.onConfirm}>{props.busy ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}删除本地备份</button></div>
  </ModalFrame>
}

function ShelfModal(props: { project: Project; onClose(): void; onChanged(message: string): Promise<void>; onError(value: unknown): void }): ReactNode {
  const [shelves, setShelves] = useState<ShelvedChange[]>([])
  const [title, setTitle] = useState('当前未完成修改')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>()
  const { project, onError } = props
  const load = useCallback(async () => {
    try { setShelves(unwrap(await window.vibegit.listShelves(project.id))) }
    catch (value) { onError(value) }
    finally { setLoading(false) }
  }, [project.id, onError])
  useEffect(() => {
    let active = true
    void window.vibegit.listShelves(project.id)
      .then((result) => { if (active) setShelves(unwrap(result)) })
      .catch((value: unknown) => { if (active) onError(value) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [project.id, onError])

  const create = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!title.trim()) return
    setBusy('create')
    try {
      unwrap(await window.vibegit.createShelf(project.id, title.trim()))
      await load()
      await props.onChanged('当前修改已暂时收起，随时可以取回')
    } catch (value) { onError(value) }
    finally { setBusy(undefined) }
  }
  const retrieve = async (shelf: ShelvedChange): Promise<void> => {
    setBusy(shelf.id)
    try {
      unwrap(await window.vibegit.retrieveShelf(shelf.id))
      await load()
      await props.onChanged(`已取回“${shelf.title}”`)
    } catch (value) { onError(value) }
    finally { setBusy(undefined) }
  }

  return <ModalFrame title="暂时收起修改" subtitle="把未完成的修改安全隐藏起来，之后可以完整取回；不会直接删除新增文件。" onClose={props.onClose}>
    <div className="shelf-content">
      <form className="shelf-create" onSubmit={(event) => void create(event)}><label>这组修改的名称<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /></label><button className="button primary" disabled={!title.trim() || Boolean(busy)}>{busy === 'create' ? <LoaderCircle className="spin" size={16} /> : <Archive size={16} />}安全收起当前修改</button></form>
      <div className="shelf-note"><ShieldCheck size={17} /><p>收起前会先创建保存点；取回时如果当前项目又有变化，也会先建立保险点。</p></div>
      <div className="shelf-list"><div className="section-title"><div><h3>已经收起的修改</h3><p>只有“等待取回”的记录可以操作。</p></div></div>{loading ? <LoadingView compact label="正在读取…" /> : shelves.filter((shelf) => shelf.status === 'active').length === 0 ? <div className="empty-shelves"><Archive size={22} /><span>还没有暂时收起的修改</span></div> : shelves.filter((shelf) => shelf.status === 'active').map((shelf) => <div className="shelf-row" key={shelf.id}><ArchiveRestore size={18} /><div><strong>{shelf.title}</strong><small>{formatRelativeTime(shelf.createdAt)}</small></div><button className="button secondary small" disabled={Boolean(busy)} onClick={() => void retrieve(shelf)}>{busy === shelf.id ? <LoaderCircle className="spin" size={14} /> : <ArchiveRestore size={14} />}取回修改</button></div>)}</div>
      <div className="modal-actions"><button className="button ghost" onClick={props.onClose}>关闭</button></div>
    </div>
  </ModalFrame>
}

function RestoreModal(props: { preview: RestorePreview; checkpoint: Checkpoint; busy: boolean; onClose(): void; onConfirm(): void }): ReactNode {
  const [confirmed, setConfirmed] = useState(false)
  return <ModalFrame danger title={`回到“${props.checkpoint.title}”`} subtitle="VibeGit 已先保存当前状态。请确认下面的影响后再继续。" onClose={props.onClose}>
    <div className="restore-overview"><div><FilePlus2 size={19} /><strong>{props.preview.addCount}</strong><span>将恢复</span></div><div><GitCompareArrows size={19} /><strong>{props.preview.overwriteCount}</strong><span>将覆盖</span></div><div><AlertTriangle size={19} /><strong>{props.preview.removeCount}</strong><span>将移出当前版本</span></div><div><ShieldAlert size={19} /><strong>{props.preview.conflictCount}</strong><span>将移入恢复区</span></div></div>
    <div className="impact-list">{props.preview.files.length === 0 ? <p>两个版本的文件内容相同。</p> : props.preview.files.slice(0, 80).map((file) => <div key={`${file.action}-${file.path}`}><span className={`impact-icon ${file.action}`}>{file.action === 'add' ? '+' : file.action === 'remove' ? '−' : file.action === 'move_to_recovery' ? '!' : '↻'}</span><span><strong>{file.path}</strong><small>{file.reason}</small></span></div>)}</div>
    <div className="insurance-note"><ShieldCheck size={20} /><div><strong>当前状态已经存入“回退前保险点”</strong><p>回退后可点击“撤销本次回退”，不会永久丢失现在的代码。</p></div></div>
    <label className="confirm-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我已了解这些文件变化，确认回到这个版本</label>
    <div className="modal-actions"><button className="button ghost" onClick={props.onClose}>暂不回退</button><button className="button danger" disabled={!confirmed || props.busy} onClick={props.onConfirm}>{props.busy ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}确认并安全回退</button></div>
  </ModalFrame>
}

function BackupModal(props: { project: Project; onClose(): void; onProjectChange(): Promise<void>; onSuccess(message: string): void; onError(value: unknown): void }): ReactNode {
  const { project, onError } = props
  const [status, setStatus] = useState<GitHubCliStatus>()
  const [scan, setScan] = useState<SensitiveScanResult>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>()
  const [repoName, setRepoName] = useState(project.name.replace(/[^A-Za-z0-9._-]/g, '-') || 'vibegit-project')
  const [remoteUrl, setRemoteUrl] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [nextStatus, nextScan] = await Promise.all([window.vibegit.githubStatus(), window.vibegit.githubScan(project.id)])
      setStatus(unwrap(nextStatus)); setScan(unwrap(nextScan))
    } catch (value) { onError(value) }
    finally { setLoading(false) }
  }, [project.id, onError])
  useEffect(() => {
    let active = true
    void Promise.all([window.vibegit.githubStatus(), window.vibegit.githubScan(project.id)])
      .then(([nextStatus, nextScan]) => {
        if (!active) return
        setStatus(unwrap(nextStatus))
        setScan(unwrap(nextScan))
      })
      .catch((value: unknown) => { if (active) onError(value) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [project.id, onError])

  const createPrivate = async (): Promise<void> => {
    setBusy('create')
    try { unwrap(await window.vibegit.githubCreatePrivate({ projectId: props.project.id, name: repoName })); await props.onProjectChange(); props.onSuccess('GitHub 私有仓库已创建并连接') }
    catch (value) { props.onError(value) } finally { setBusy(undefined) }
  }
  const connect = async (): Promise<void> => {
    setBusy('connect')
    try { unwrap(await window.vibegit.githubConnect({ projectId: props.project.id, remoteUrl })); await props.onProjectChange(); props.onSuccess('GitHub 备份位置已连接') }
    catch (value) { props.onError(value) } finally { setBusy(undefined) }
  }
  const authorize = async (): Promise<void> => {
    setBusy('authorize')
    try {
      const result = unwrap(await window.vibegit.githubAuthorize())
      await refresh()
      props.onSuccess(result.message)
    } catch (value) { props.onError(value) } finally { setBusy(undefined) }
  }
  const push = async (): Promise<void> => {
    setBusy('push')
    try {
      const currentScan = unwrap(await window.vibegit.githubScan(props.project.id)); setScan(currentScan)
      if (currentScan.blocked) return
      unwrap(await window.vibegit.githubPush(props.project.id)); await props.onProjectChange(); props.onSuccess('项目已安全备份到 GitHub'); props.onClose()
    } catch (value) { props.onError(value) } finally { setBusy(undefined) }
  }
  const ignore = async (item: SensitiveRisk): Promise<void> => {
    setBusy(`ignore-${item.path}`)
    try { setScan(unwrap(await window.vibegit.githubIgnoreRisk(props.project.id, item))) }
    catch (value) { props.onError(value) } finally { setBusy(undefined) }
  }

  return <ModalFrame wide title="GitHub 私有备份" subtitle="只会备份到你自己的 Private 仓库；每次上传前都会扫描风险。" onClose={props.onClose}>
    {loading ? <LoadingView label="正在检查 GitHub 和项目安全状态…" compact /> : <div className="backup-content">
      <div className={`connection-card ${status?.authenticated ? 'connected' : 'offline'}`}>
        <span>{status?.authenticated ? <CheckCircle2 size={20} /> : <TerminalSquare size={20} />}</span>
        <div>
          <strong>{status?.authenticated ? `GitHub 已连接${status.username ? ` · ${status.username}` : ''}` : status?.installed ? 'GitHub 尚未登录' : '尚未安装 GitHub CLI'}</strong>
          <p>{status?.message}</p>
          {status?.installed && !status?.sshKeyReady && <div className="connection-actions"><button className="button secondary small" disabled={Boolean(busy)} onClick={() => void authorize()}>{busy === 'authorize' ? <LoaderCircle className="spin" size={14} /> : <LockKeyhole size={14} />}{status.authenticated ? '创建并关联 SSH 密钥' : '连接 GitHub 并创建 SSH 密钥'}</button><small>会打开 GitHub 授权页面，并只向你的账户关联 VibeGit 专用公钥。</small></div>}
          {status?.sshKeyReady && <small className="connection-ready"><ShieldCheck size={14} />已使用 VibeGit 专用 SSH 密钥</small>}
          {!status?.installed && <small>安装 GitHub CLI 后，即可在这里一键完成浏览器授权。</small>}
        </div>
      </div>
      {!props.project.githubRemoteUrl ? <div className="backup-setup-grid"><form onSubmit={(event) => { event.preventDefault(); void createPrivate() }}><span className="pill safe">推荐</span><h3>创建新的私有仓库</h3><p>显式创建为 Private，不会公开你的源代码。</p><label>仓库名称<input value={repoName} onChange={(event) => setRepoName(event.target.value)} /></label><button className="button primary" disabled={!status?.authenticated || !status?.sshKeyReady || Boolean(busy)}>{busy === 'create' ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}创建并连接</button></form><form onSubmit={(event) => { event.preventDefault(); void connect() }}><span className="pill neutral">已有仓库</span><h3>连接现有私有仓库</h3><p>登录后会验证仓库确实是 Private，再设置备份位置。</p><label>GitHub 备份位置<input value={remoteUrl} onChange={(event) => setRemoteUrl(event.target.value)} placeholder="https://github.com/you/project.git" /></label><button className="button secondary" disabled={!status?.authenticated || !status?.sshKeyReady || !remoteUrl.trim() || Boolean(busy)}>验证并连接</button></form></div> : <div className="remote-card"><Cloud size={20} /><div><strong>备份位置已设置</strong><p>{props.project.githubRemoteUrl}</p></div><span className={`pill ${props.project.githubSyncStatus === 'synced' ? 'safe' : 'warning'}`}>{props.project.githubSyncStatus === 'synced' ? '已同步' : '等待同步'}</span></div>}
      <div className="scan-section"><div className="section-title"><div><h3>上传前安全检查</h3><p>检查环境变量、私钥、访问令牌、数据库、大文件和生成目录。</p></div><button className="button ghost" onClick={() => void refresh()}><RefreshCw size={15} />重新扫描</button></div>{scan?.blocked ? <div className="risk-list"><div className="risk-heading"><ShieldAlert size={19} /><strong>发现 {scan.risks.length} 项风险，已阻止上传</strong></div>{scan.risks.map((item) => <div className="risk-item" key={`${item.kind}-${item.path}`}><AlertTriangle size={17} /><div><strong>{item.path}</strong><p>{item.message}</p></div>{item.ignoreSuggestion && <button className="button small" disabled={Boolean(busy)} onClick={() => void ignore(item)}>{busy === `ignore-${item.path}` ? <LoaderCircle className="spin" size={14} /> : null}加入忽略列表</button>}</div>)}</div> : <div className="scan-safe"><ShieldCheck size={20} /><span><strong>未发现阻止备份的风险</strong><small>已检查 {scan?.scannedFiles ?? 0} 个文件</small></span></div>}</div>
      <div className="modal-actions"><button className="button ghost" onClick={props.onClose}>关闭</button><button className="button primary" disabled={!props.project.githubRemoteUrl || !status?.authenticated || scan?.blocked || Boolean(busy)} onClick={() => void push()}>{busy === 'push' ? <LoaderCircle className="spin" size={17} /> : <Cloud size={17} />}安全备份到 GitHub</button></div>
    </div>}
  </ModalFrame>
}

function LanguagePreferences(): ReactNode {
  const [displayLanguage, setDisplayLanguage] = useState<DisplayLanguage>(savedDisplayLanguage)

  useEffect(() => {
    applyDisplayLanguage(displayLanguage)
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, displayLanguage)
    window.dispatchEvent(new CustomEvent<DisplayLanguage>('vibegit:language-change', { detail: displayLanguage }))
  }, [displayLanguage])

  return (
    <section className="page language-preferences-page" aria-labelledby="display-language-heading">
      <div className="settings-card language-settings-card">
        <div className="settings-card-title">
          <Languages size={19} />
          <div>
            <h2 id="display-language-heading">界面语言</h2>
            <p>默认使用简体中文。选择会自动保存；阿拉伯语将采用从右到左的阅读方向。</p>
          </div>
        </div>
        <label className="language-select-label" htmlFor="display-language">
          显示语言
          <select id="display-language" value={displayLanguage} onChange={(event) => setDisplayLanguage(event.target.value as DisplayLanguage)}>
            {DISPLAY_LANGUAGES.map((language) => <option key={language.value} value={language.value}>{language.nativeLabel} · {language.label}</option>)}
          </select>
        </label>
      </div>
    </section>
  )
}

function ChangePresentationPreferences(): ReactNode {
  const [presentation, setPresentation] = useState<ChangePresentation>(savedChangePresentation)

  useEffect(() => {
    window.localStorage.setItem(CHANGE_PRESENTATION_STORAGE_KEY, presentation)
    window.dispatchEvent(new CustomEvent<ChangePresentation>('vibegit:change-presentation', { detail: presentation }))
  }, [presentation])

  return <section className="page preferences-page"><div className="settings-card preferences-card change-presentation-card"><div className="settings-card-title"><Sparkles size={19} /><div><h2>保存点显示方式</h2><p>为非程序员显示大白话的功能变化；也可随时切回完整代码差异。</p></div></div><fieldset className="change-presentation-options"><legend><strong>查看这次改了什么</strong><span>默认使用功能变化视图</span></legend><label className={presentation === 'feature' ? 'active' : ''}><input type="radio" name="change-presentation" value="feature" checked={presentation === 'feature'} onChange={() => setPresentation('feature')} /><span className="change-presentation-icon"><Sparkles size={17} /></span><span className="change-presentation-copy"><strong>功能变化</strong><small>新增、改进和删除了哪些功能</small></span><span className="change-presentation-indicator"><Check size={14} /></span></label><label className={presentation === 'code' ? 'active' : ''}><input type="radio" name="change-presentation" value="code" checked={presentation === 'code'} onChange={() => setPresentation('code')} /><span className="change-presentation-icon"><FileCode2 size={17} /></span><span className="change-presentation-copy"><strong>代码变更</strong><small>文件列表与逐行代码差异</small></span><span className="change-presentation-indicator"><Check size={14} /></span></label></fieldset></div></section>
}

function DataDirectoryPreferences(): ReactNode {
  const [settings, setSettings] = useState<AppSettings>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()

  useEffect(() => { void window.vibegit.getSettings().then((result) => setSettings(unwrap(result))) }, [])

  const chooseDirectory = async (): Promise<void> => {
    setBusy(true)
    setNotice(undefined)
    try {
      const path = unwrap(await window.vibegit.selectDataDirectory())
      if (!path) return
      const update = unwrap(await window.vibegit.setDataDirectory(path))
      setSettings((current) => current ? { ...current, dataDirectory: update.dataDirectory } : current)
      setNotice(update.restartRequired ? '已保存新的记录位置。重启 VibeGit 后会使用该位置，现有记录不会被删除。' : '记录位置未变更。')
    } catch (value) {
      setNotice(errorFrom(value).message)
    } finally {
      setBusy(false)
    }
  }

  return <section className="page preferences-page"><div className="settings-card preferences-card"><div className="settings-card-title"><HardDrive size={19} /><div><h2>本地记录位置</h2><p>选择保存保护记录、诊断日志和 VibeGit 专用 SSH 数据的本地文件夹。</p></div></div><div className="preferences-action"><code title={settings?.dataDirectory}>{settings?.dataDirectory ?? '读取中…'}</code><button className="button secondary small" disabled={busy} onClick={() => void chooseDirectory()}>{busy ? <LoaderCircle className="spin" size={14} /> : <FolderOpen size={14} />}选择文件夹</button></div>{notice && <p className="preferences-notice">{notice}</p>}</div></section>
}

function EnvironmentPreferences(): ReactNode {
  const [result, setResult] = useState<EnvironmentCheckResult>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [skillCommand, setSkillCommand] = useState<string>()

  const check = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const checked = unwrap(await window.vibegit.checkEnvironment())
      setResult(checked)
      setSkillCommand(checked.changeSummarySkill.ready ? undefined : checked.changeSummarySkill.deploymentCommand)
    }
    catch (value) { setError(errorFrom(value).message) }
    finally { setBusy(false) }
  }

  const skillStatus = !result ? undefined : !result.changeSummarySkill.codex.available && !result.changeSummarySkill.claudeCode.available ? '没有需要部署的 Agent' : result.changeSummarySkill.ready ? '已部署' : '待部署'
  const foundByVolumeScan = result?.agents.codex.detection === 'volume-scan' || result?.agents.claudeCode.detection === 'volume-scan'
  return <><section className="page preferences-page"><div className="settings-card preferences-card"><div className="settings-card-title"><TerminalSquare size={19} /><div><h2>配置环境</h2><p>扫描 GitHub CLI、Codex、Claude Code 和 VibeGit 改动说明 Skill。缺少 GitHub CLI 时会通过 Windows 包管理器自动安装。</p></div></div><div className="preferences-action"><div className="environment-result">{result ? <><span><i className={result.github.installed ? 'status-dot safe' : 'status-dot'} />GitHub CLI：{result.github.installed ? '已就绪' : '未找到'} · Codex：{result.agents.codex.installed ? '已检测' : '未找到'} · Claude Code：{result.agents.claudeCode.installed ? '已检测' : '未找到'}</span>{foundByVolumeScan && <span className="environment-scan-notice">已通过全盘扫描定位 Agent</span>}<span className={result.changeSummarySkill.ready ? 'environment-skill ready' : 'environment-skill missing'}><span>VibeGit 改动说明 Skill：</span>{skillStatus}</span></> : '尚未检测'}</div><button className="button primary small" disabled={busy} onClick={() => void check()}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}检测配置环境</button></div>{result?.githubCliInstallAttempted && <p className="preferences-notice">{result.githubCliInstalled ? '已自动安装 GitHub CLI；如仍未显示，请重启 VibeGit 后再次检测。' : result.message}</p>}{error && <p className="preferences-notice error">{error}</p>}</div></section>{skillCommand && <SkillDeploymentModal command={skillCommand} onClose={() => setSkillCommand(undefined)} />}</>
}

function SkillDeploymentModal({ command, onClose }: { command: string; onClose(): void }): ReactNode {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(command)
      else {
        const field = document.createElement('textarea')
        field.value = command
        field.style.position = 'fixed'
        field.style.opacity = '0'
        document.body.append(field)
        field.select()
        if (!document.execCommand('copy')) throw new Error('Copy failed')
        field.remove()
      }
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return <ModalFrame wide title="未部署 VibeGit 改动说明 Skill" subtitle="为了让保存点显示“功能变化”，请把下面英文指令复制给 Codex 或 Claude Code 并发送。它只会为本机已安装的 Agent 创建 VibeGit Skill。" onClose={onClose}>
    <div className="skill-deployment-content"><div className="skill-deployment-note"><Sparkles size={18} /><span>检测到至少一个已安装的 Agent 缺少此 Skill；代码变更视图仍可正常使用。</span></div><pre className="skill-deployment-command">{command}</pre><div className="modal-actions"><span className="copy-status" aria-live="polite">{copied ? '已复制' : ''}</span><button className="button ghost" onClick={onClose}>关闭</button><button className="button primary" onClick={() => void copy()}><Copy size={16} />复制英文部署指令</button></div></div>
  </ModalFrame>
}

function SettingsView({ onBack }: { onBack(): void }): ReactNode {
  const [settings, setSettings] = useState<AppSettings>()
  const [agents, setAgents] = useState<AgentConnectionStatus>()
  const [health, setHealth] = useState<string>('检查中')
  useEffect(() => { void Promise.all([window.vibegit.getSettings(), window.vibegit.agentStatus(), window.vibegit.health()]).then(([s, a, h]) => { setSettings(unwrap(s)); setAgents(unwrap(a)); const data = unwrap(h); setHealth(data.git === 'ok' ? '本地保存引擎正常' : '未找到 Git') }).catch(() => setHealth('状态检查失败')) }, [])
  return <section className="page settings-page"><header className="page-header compact"><div><button className="back-link" onClick={onBack}><ArrowLeft size={15} />返回</button><p className="eyebrow">设置与连接</p><h1>保护引擎状态</h1><p>这些信息用于确认 VibeGit 能否自动保存每轮 Agent 修改。</p></div></header><div className="settings-grid"><section className="settings-card"><div className="settings-card-title"><HardDrive size={19} /><div><h2>本地数据</h2><p>只存保存点说明和操作记录，源码仍在项目中。</p></div></div><dl><div><dt>状态</dt><dd><span className="status-dot safe" />{health}</dd></div><div><dt>记录位置</dt><dd title={settings?.dataDirectory}>{settings?.dataDirectory ?? '读取中…'}</dd></div><div><dt>命令超时</dt><dd>{settings ? `${settings.commandTimeoutMs / 1000} 秒` : '—'}</dd></div></dl></section><section className="settings-card"><div className="settings-card-title"><Sparkles size={19} /><div><h2>Agent 连接</h2><p>通过统一事件 CLI 在修改前后创建保护点。</p></div></div><AgentRow name="Codex" status={agents?.codex} /><AgentRow name="Claude Code" status={agents?.claudeCode} /><div className="command-note"><code>node dist/cli/index.js event --stdin</code><p>自包含的 vibegit 可执行文件和自动安装器属于下一阶段。</p></div></section><section className="settings-card span-2"><div className="settings-card-title"><ShieldCheck size={19} /><div><h2>默认安全规则</h2><p>这些规则始终生效，不能被普通操作绕过。</p></div></div><div className="safety-grid"><span><Check size={15} />回退前自动保险</span><span><Check size={15} />不删除未跟踪文件</span><span><Check size={15} />禁止强制推送</span><span><Check size={15} />上传前扫描敏感文件</span><span><Check size={15} />Renderer 无文件系统权限</span><span><Check size={15} />Git 命令有超时限制</span></div></section></div></section>
}

function AgentRow({ name, status }: { name: string; status?: AgentConnectionStatus['codex'] | undefined }): ReactNode {
  return <div className="agent-row"><span className={`agent-icon ${status?.installed ? 'online' : ''}`}><Code2 size={17} /></span><div><strong>{name}</strong><small>{status?.detail ?? '正在检测…'}</small></div><span className={`pill ${status?.installed ? 'safe' : 'neutral'}`}>{status?.installed ? '已检测' : '未连接'}</span></div>
}

function ModalFrame({ title, subtitle, onClose, danger, wide, children }: { title: string; subtitle: string; onClose(): void; danger?: boolean; wide?: boolean; children: ReactNode }): ReactNode {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`modal ${danger ? 'modal-danger' : ''} ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><div className={danger ? 'danger-symbol' : 'modal-symbol'}>{danger ? <ShieldAlert size={22} /> : <ShieldCheck size={22} />}</div><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>{children}</section></div>
}

function ErrorBanner({ error, onClose }: { error: PublicError; onClose(): void }): ReactNode {
  return <div className="toast toast-error" role="alert"><AlertTriangle size={18} /><span><strong>{error.message}</strong>{error.detail && <small>{error.detail}</small>}{error.remediation && <small>{error.remediation}</small>}</span><button className="icon-button" aria-label="关闭错误" onClick={onClose}><X size={16} /></button></div>
}

function LoadingView({ label, compact }: { label: string; compact?: boolean }): ReactNode {
  return <div className={`loading-view ${compact ? 'compact' : ''}`}><LoaderCircle className="spin" size={compact ? 22 : 30} /><span>{label}</span></div>
}
