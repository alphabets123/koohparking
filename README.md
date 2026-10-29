# 🚗 구병원 초경량 주차감면 시스템 (Cloudflare Pages)

구병원 원내 주차 관제 서버(`http://211.105.143.22/`)의 감면 및 차량 조회 API를 모바일/EMR 최적화 컴팩트 뷰로 중계하는 Cloudflare Pages 전용 프로젝트입니다.

---

## 📁 프로젝트 구조

```
E:\koohparking\
├── public\
│   └── index.html               # 모바일 컴팩트 UI (Pretendard, Tailwind, 터치키패드, 선택삭제, 사진조회)
├── functions\
│   └── api\
│       └── [[route]].js         # Cloudflare Pages 엣지 리버스 프록시 (주차서버 CORS/Mixed Content 해결)
├── .gitignore
└── README.md
```

---

## 🚀 깃허브(GitHub) 및 클라우드플레어(Cloudflare Pages) 배포 방법

### 1단계: 깃 초기화 및 푸시

1. **GitHub 웹사이트**에서 새 레포지토리를 생성합니다:
   - Repository name: `koohparking`
   - Public 또는 Private 선택
2. **VS Code / 터미널**에서 아래 명령어를 실행하여 푸시합니다:

```bash
cd E:\koohparking
git init
git add .
git commit -m "feat: 구병원 주차감면 Cloudflare Pages 초기 배포"
git branch -M main
git remote add origin https://github.com/내아이디/koohparking.git
git push -u origin main
```

---

### 2단계: Cloudflare Pages 연결 (단 10초)

1. [Cloudflare 대시보드](https://dash.cloudflare.com/) 로그인
2. 좌측 메뉴 **`Workers & Pages`** 클릭 ➔ **`Create application`** 클릭
3. **`Pages`** 탭 선택 ➔ **`Connect to Git`** 클릭
4. 방금 생성한 **`koohparking`** 레포지토리 선택
5. 빌드 설정:
   - **Framework preset**: `None`
   - **Build output directory**: `public`
6. **`Save and Deploy`** 클릭!

➔ 약 10~15초 후 **`https://koohparking.pages.dev`** (또는 내가 지정한 이름) 주소로 즉시 전 세계에 배포 완료됩니다!

---

## ✨ 탑재된 핵심 기능

1. **차량번호 4자리 초고속 검색**: 숫자 4자리 치는 즉시 주차서버로 자동 조회 (`/api/searchcar`)
2. **실시간 LPR 번호판 사진 조회**: 카메라로 촬영된 실물 사진 모달 표출 (`/api/inimage`)
3. **원클릭 감면 퀵버튼**: 외래 2시간 / 외래 4시간 / 입원 당일무료 / 인공신장실 등 원터치 전송 (`/api/insert`)
4. **기적용된 감면 선택삭제**: 타 부서/창구 감면 내역 조회 및 내 부서 건 취소 (`/api/delete`)
5. **접이식 터치 키패드**: 모바일/태블릿 및 터치 모니터 환경에서 키패드 온/오프 토글
6. **부서 아이디 기억하기**: PC/스마트폰별 1회 로그인 아이디 자동 저장
7. **모바일 홈 화면 추가**: 스마트폰 브라우저에서 '홈 화면에 추가' 시 앱 아이콘 형태로 전체화면 실행
