/**
 * 구병원 주차감면 원내 통합 코어 서버 (parking-server.js)
 * - 포트: 3150
 * - 프로세스명: parking-server
 * - 소스 경로: X:\parking\parking-server.js
 * - 주차 관제 서버 연동: http://211.105.143.22:80
 * - 외부 라이브러리(npm install) 없이 Node.js 기본 내장 모듈만으로 가볍고 안정적으로 구동됩니다.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL, URLSearchParams } = require("url");

const PORT = process.env.PORT || 3150;
const TARGET_HOST = "211.105.143.22";
const TARGET_PORT = 80;

// 각 클라이언트(브라우저)별 세션 쿠키 개별 격리 (전역 공유 금지)

function proxyToParkingServer({ method, targetPath, headers = {}, body = null }, clientRes) {
  const reqHeaders = {
    "Host": TARGET_HOST,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "*/*",
    "X-Requested-With": "XMLHttpRequest",
    ...headers,
  };

  if (body) {
    const bodyBuf = Buffer.from(body, "utf8");
    reqHeaders["Content-Length"] = bodyBuf.length;
  }

  const options = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: targetPath,
    method: method,
    headers: reqHeaders,
    timeout: 10000,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // 세션 쿠키 수집 및 클라이언트로 전달 (서버 전역 공유 방지)
    const rawSetCookies = proxyRes.headers["set-cookie"];
    if (rawSetCookies && rawSetCookies.length > 0) {
      const cookiePairs = rawSetCookies.map((c) => c.split(";")[0]);
      const normalizedCookies = cookiePairs.map((pair) => `${pair}; Path=/; HttpOnly`);
      clientRes.setHeader("Set-Cookie", normalizedCookies);
    }

    const contentType = proxyRes.headers["content-type"] || "application/json; charset=utf-8";
    clientRes.writeHead(proxyRes.statusCode || 200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate",
    });

    proxyRes.pipe(clientRes);
  });

  proxyReq.on("error", (err) => {
    clientRes.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    clientRes.end(JSON.stringify({ errcode: "502", msg: "주차 관제 서버(211.105.143.22) 연결 실패: " + err.message }));
  });

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    clientRes.writeHead(504, { "Content-Type": "application/json; charset=utf-8" });
    clientRes.end(JSON.stringify({ errcode: "504", msg: "주차 관제 서버 응답 시간 초과" }));
  });

  if (body) {
    proxyReq.write(body);
  }
  proxyReq.end();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function requestToParkingServer({ method, targetPath, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const reqHeaders = {
      "Host": TARGET_HOST,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
      ...headers,
    };
    if (body) {
      const bodyBuf = Buffer.from(body, "utf8");
      reqHeaders["Content-Length"] = bodyBuf.length;
    }
    const options = {
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: targetPath,
      method: method,
      headers: reqHeaders,
      timeout: 8000,
    };
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk.toString("utf8"));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    if (body) req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = reqUrl.pathname;

  // 1. API 중계 라우트 (/api/*)
  if (pathname.startsWith("/api/")) {
    const action = pathname.replace(/^\/api\/?/, "");
    const incomingCookie = req.headers["cookie"] || "";
    const headers = {};
    if (incomingCookie) {
      headers["Cookie"] = incomingCookie;
    }

    try {
      // 0) 로그아웃 (세션 쿠키 파기 및 원격 관제서버 로그아웃)
      if (action === "logout") {
        const expireCookies = [
          "TSESSIONID=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly",
          "ASP.NET_SessionId=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly",
          ".AspNetCore.Session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly"
        ];
        if (incomingCookie) {
          incomingCookie.split(";").forEach((pair) => {
            const name = pair.split("=")[0].trim();
            if (name) {
              expireCookies.push(`${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly`);
            }
          });
        }
        try {
          await requestToParkingServer({ method: "POST", targetPath: "/login/logout", headers }).catch(() => {});
        } catch (e) {}

        res.setHeader("Set-Cookie", expireCookies);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: true, msg: "로그아웃 완료" }));
      }

      // 1) 로그인
      if (action === "login") {
        const data = await readJsonBody(req);
        const id = (data.id || "").trim();
        const pw = data.pw || "";
        const bs = Buffer.from(pw, "utf8").toString("base64");
        const formBody = new URLSearchParams({ bs, id, pw: "" }).toString();

        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/login/identify", headers, body: formBody },
          res
        );
      }

      // 2) 스마트 통합 차량 검색 (/discount/searchcar + /home/carnumsearch 병합)
      if (action === "searchcar") {
        const data = await readJsonBody(req);
        const carnum = (data.carnum || "").trim();
        
        // 🕒 한국 표준시 (KST, Asia/Seoul) 엄격 적용
        const kstFormatter = new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
        const pParts = {};
        kstFormatter.formatToParts(new Date()).forEach((pt) => (pParts[pt.type] = pt.value));
        const today = `${pParts.year}-${pParts.month}-${pParts.day}`;
        const kstFullTime = `${today} ${pParts.hour}:${pParts.minute}:${pParts.second}`;

        // (1) 일반 방문객 할인 검색
        const formBody = new URLSearchParams({ carnum }).toString();
        const p1 = requestToParkingServer({
          method: "POST",
          targetPath: "/discount/searchcar",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: formBody,
        }).catch((err) => ({ data: { total: 0, result: [] } }));

        // (2) 방문확인 전체 차량 검색 (직원 정기 등록차량 및 부서/성명 포함)
        const visitBody = `sdt=${today}&edt=${today}&value=${encodeURIComponent(carnum)}&pagesize=100&page=1`;
        const p2 = requestToParkingServer({
          method: "POST",
          targetPath: "/home/carnumsearch",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: visitBody,
        }).catch((err) => ({ data: { total: 0, result: [] } }));

        const [r1, r2] = await Promise.all([p1, p2]);

        const discountList = (r1.data && r1.data.result) || [];
        const visitList = (r2.data && r2.data.result) || [];

        // 방문확인 데이터 맵핑 (차량번호 기준)
        const visitMap = {};
        visitList.forEach((v) => {
          const num = (v["차량번호"] || "").trim();
          if (num) {
            visitMap[num] = v;
          }
        });

        const finalResults = [];

        // 1. 일반 할인 리스트에 방문위치/정기구분 정보 결합 (KST 현재시간 동기화)
        discountList.forEach((car) => {
          const num = (car["차량번호"] || "").trim();
          const v = visitMap[num];
          finalResults.push({
            ...car,
            현재시간: kstFullTime,
            xindex: car.xindex || (v ? v.idx : ""),
            정기구분: (v && v["정기구분"]) || "미등록차량",
            방문위치: (v && (v["사용자명"] || v["동호수"])) || "",
            전화번호: (v && v["전화번호"]) || "",
            isStaff: false,
          });
          if (v) delete visitMap[num];
        });

        // 2. 할인 리스트에서 누락되었던 직원 등록차량(정기차량) 추가
        Object.values(visitMap).forEach((v) => {
          const isReg = v["정기구분"] === "등록차량";
          finalResults.push({
            차량번호: v["차량번호"],
            입차일시: v["입차시간"],
            현재시간: kstFullTime,
            xindex: v.idx,
            정기구분: v["정기구분"] || (isReg ? "등록차량" : "미등록차량"),
            방문위치: v["사용자명"] || v["동호수"] || "",
            전화번호: v["전화번호"] || "",
            isStaff: isReg,
          });
        });

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(
          JSON.stringify({
            errcode: null,
            msg: "OK",
            total: finalResults.length,
            result: finalResults,
          })
        );
      }

      // 3) 입차 카메라 LPR 사진 (일반차량 / 등록차량 자동 분기)
      if (action === "inimage") {
        const xindex = reqUrl.searchParams.get("xindex") || "";
        const visitchk = reqUrl.searchParams.get("visitchk") || "";
        const targetPath =
          visitchk === "등록차량"
            ? `/mobile/VisitImage?xindex=${encodeURIComponent(xindex)}&visitchk=${encodeURIComponent(visitchk)}`
            : `/discount/InImage?xindex=${encodeURIComponent(xindex)}`;

        return proxyToParkingServer(
          {
            method: "GET",
            targetPath: targetPath,
            headers,
          },
          res
        );
      }

      // 4) 휴일 여부 확인
      if (action === "isholiday") {
        return proxyToParkingServer(
          { method: "GET", targetPath: "/discount/isholiday", headers },
          res
        );
      }

      // 5) 계정별 할인권 목록
      if (action === "discountinfo") {
        return proxyToParkingServer(
          { method: "GET", targetPath: "/discount/discountinfo", headers },
          res
        );
      }

      // 6) 특정 할인코드 건수
      if (action === "discountcodecount") {
        const code = reqUrl.searchParams.get("code") || "";
        return proxyToParkingServer(
          {
            method: "GET",
            targetPath: `/discount/discountcodecount?discuntcode=${encodeURIComponent(code)}`,
            headers,
          },
          res
        );
      }

      // 7) 부서 잔여 수량
      if (action === "occupantdiscount") {
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/discount/occupantdiscount", headers, body: "" },
          res
        );
      }

      // 8) 특정 차량의 기적용 감면 내역
      if (action === "discountrecords") {
        const data = await readJsonBody(req);
        const formBody = new URLSearchParams({ xindex: data.xindex || "" }).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/discount/discountrecords", headers, body: formBody },
          res
        );
      }

      // 9) 감면 등록
      if (action === "insert") {
        const data = await readJsonBody(req);
        const formBody = new URLSearchParams({
          carfullnum: data.carfullnum || "",
          xindex: data.xindex || "",
          carnum: data.carnum || "",
          discountcode: data.discountcode || "",
          note: data.note || "",
        }).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/discount/insert", headers, body: formBody },
          res
        );
      }

      // 10) 감면 선택 삭제
      if (action === "delete") {
        const data = await readJsonBody(req);
        const formBody = new URLSearchParams({
          xindex: data.xindex || "",
          idx: data.idx || "",
          xcompany: data.xcompany || "",
        }).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/discount/delete", headers, body: formBody },
          res
        );
      }

      // 11) 전체 할인 내역 조회 (/discount/records)
      if (action === "records") {
        const data = await readJsonBody(req);
        const formBody = new URLSearchParams({
          discountcode: data.discountcode || "",
          saletype: data.saletype || "",
          sdt: data.sdt || "",
          edt: data.edt || "",
        }).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/discount/records", headers, body: formBody },
          res
        );
      }

      // 12) 비밀번호 변경
      if (action === "changepassword") {
        const data = await readJsonBody(req);
        const formBody = new URLSearchParams({
          pw: data.pw || "",
        }).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/discount/changepassword", headers, body: formBody },
          res
        );
      }

      // 13) 방문예약 내역 조회 (/home/reservesearch)
      if (action === "reservesearch" || action === "reserverecords") {
        const data = await readJsonBody(req);
        // 관제 서버 ureserve.html 기본 규격: gubun 기본값은 '방문등록' (부서별 예약 목록 전체 반환)
        const gubun = data.gubun || "방문등록";
        const formBody = new URLSearchParams({
          userid: data.userid || "",
          sdt: data.sdt || "",
          edt: data.edt || "",
          gubun: gubun,
          value: data.value || "",
          pagesize: String(data.pagesize || 100),
          page: String(data.page || 1),
        }).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/home/reservesearch", headers, body: formBody },
          res
        );
      }

      // 14) 방문예약 등록 (/home/reserveinsert)
      if (action === "reserveinsert" || action === "reserveInsert") {
        const data = await readJsonBody(req);
        const today = new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date()).replace(/\. /g, "-").replace(".", "");

        const visitDate = data.resvindt || data.visitdt || today;
        const outDate = data.resvoutdt || visitDate;
        const outTime = data.resvouttm || "23:59:59";

        const formBody = new URLSearchParams({
          ids: data.ids || data.userid || "",
          name: data.name || "",
          carnum: data.carnum || "",
          tel: data.tel || "",
          business: data.business || "",
          resvindt: visitDate,
          resvoutdt: outDate,
          resvouttm: outTime,
        }).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/home/reserveinsert", headers, body: formBody },
          res
        );
      }

      // 15) 방문예약 삭제/취소 (/home/reservedelete)
      if (action === "reservedel" || action === "reservedelete") {
        const data = await readJsonBody(req);
        const formBody = new URLSearchParams({
          userid: data.userid || "",
          idx: data.idx || "",
        }).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/home/reservedelete", headers, body: formBody },
          res
        );
      }

      // 15-1) 방문예약 상세 정보 수정 (/home/reserveupdate)
      if (action === "reserveupdate") {
        const data = await readJsonBody(req);
        const formBody = new URLSearchParams({
          idx: data.idx || "",
          userid: data.userid || "",
          ticketdata: data.ticketdata || "",
          name: data.name || "",
          carnum: data.carnum || "",
          tel: data.tel || "",
          business: data.business || "",
          resvindt: data.resvindt || "",
          resvoutdt: data.resvoutdt || "",
          resvouttm: data.resvouttm || "23:59:59",
        }).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/home/reserveupdate", headers, body: formBody },
          res
        );
      }

      // 16) 방문 잔여 횟수 정보 (/home/reglimitinfo)
      if (action === "reglimitinfo") {
        return proxyToParkingServer(
          { method: "GET", targetPath: "/home/reglimitinfo", headers },
          res
        );
      }

      // 17) 입주자/방문객 차번 검색 (/mobile/chkeckvisitor)
      if (action === "chkeckvisitor") {
        const data = await readJsonBody(req);
        const formBody = new URLSearchParams({
          carnum: data.carnum || "",
        }).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        return proxyToParkingServer(
          { method: "POST", targetPath: "/mobile/chkeckvisitor", headers, body: formBody },
          res
        );
      }

      // 18) 환자/내원객 전용 차량 & 감면 등록여부 원스톱 조회 (/api/patientsearch)
      if (action === "patientsearch") {
        const data = await readJsonBody(req);
        const carnum = (data.carnum || "").trim();

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        const today = `${year}-${month}-${day}`;

        const kstOptions = {
          timeZone: "Asia/Seoul",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        };
        const formatter = new Intl.DateTimeFormat("ko-KR", kstOptions);
        const parts = formatter.formatToParts(now);
        const pMap = {};
        parts.forEach((p) => (pMap[p.type] = p.value));
        const kstFullTime = `${pMap.year}-${pMap.month}-${pMap.day} ${pMap.hour}:${pMap.minute}:${pMap.second}`;

        // (1) 일반 차량 조회
        const formBody = new URLSearchParams({ carnum }).toString();
        const p1 = requestToParkingServer({
          method: "POST",
          targetPath: "/discount/searchcar",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: formBody,
        }).catch((err) => ({ data: { total: 0, result: [] } }));

        // (2) 방문확인 전체 차량 검색 (직원 정기 등록차량 및 부서/성명 포함)
        const visitBody = `sdt=${today}&edt=${today}&value=${encodeURIComponent(carnum)}&pagesize=100&page=1`;
        const p2 = requestToParkingServer({
          method: "POST",
          targetPath: "/home/carnumsearch",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: visitBody,
        }).catch((err) => ({ data: { total: 0, result: [] } }));

        const [r1, r2] = await Promise.all([p1, p2]);
        const discountList = (r1.data && r1.data.result) || [];
        const visitList = (r2.data && r2.data.result) || [];

        const visitMap = {};
        visitList.forEach((v) => {
          const num = (v["차량번호"] || "").trim();
          if (num) {
            visitMap[num] = v;
          }
        });

        const finalResults = [];

        discountList.forEach((car) => {
          const num = (car["차량번호"] || "").trim();
          const v = visitMap[num];
          finalResults.push({
            ...car,
            현재시간: kstFullTime,
            xindex: car.xindex || (v ? v.idx : ""),
            정기구분: (v && v["정기구분"]) || "미등록차량",
            방문위치: (v && (v["사용자명"] || v["동호수"])) || "",
            전화번호: (v && v["전화번호"]) || "",
            isStaff: false,
            appliedDiscounts: [],
          });
          if (v) delete visitMap[num];
        });

        Object.values(visitMap).forEach((v) => {
          const isReg = v["정기구분"] === "등록차량";
          finalResults.push({
            차량번호: v["차량번호"],
            입차일시: v["입차시간"],
            현재시간: kstFullTime,
            xindex: v.idx,
            정기구분: v["정기구분"] || (isReg ? "등록차량" : "미등록차량"),
            방문위치: v["사용자명"] || v["동호수"] || "",
            전화번호: v["전화번호"] || "",
            isStaff: isReg,
            appliedDiscounts: [],
          });
        });

        // 각 차량의 기적용된 할인 내역 병렬 조회
        await Promise.all(
          finalResults.map(async (car) => {
            if (car.isStaff || !car.xindex) return;
            try {
              const recBody = new URLSearchParams({ xindex: car.xindex }).toString();
              const recRes = await requestToParkingServer({
                method: "POST",
                targetPath: "/discount/discountrecords",
                headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
                body: recBody,
              });
              car.appliedDiscounts = (recRes.data && recRes.data.result) || [];
            } catch (e) {
              car.appliedDiscounts = [];
            }
          })
        );

        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        return res.end(
          JSON.stringify({
            errcode: null,
            msg: "OK",
            total: finalResults.length,
            result: finalResults,
          })
        );
      }

      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ errcode: "404", msg: "알 수 없는 API 경로: " + action }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ errcode: "500", msg: err.message }));
    }
  }

  // 2. 정적 웹 파일 서빙 (public/ 디렉터리: /check 및 /kiosk 지원)
  let targetFile = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  if (targetFile === "check" || targetFile === "kiosk") {
    targetFile = "check.html";
  }
  const filePath = path.join(__dirname, "public", targetFile);
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("파일을 찾을 수 없습니다.");
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".ico": "image/x-icon",
    };
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`====================================================`);
  console.log(`🚗 구병원 주차감면 원내 통합 서버 시작 (: ${PORT} )`);
  console.log(`👉 접속 주소: http://192.168.1.183:${PORT}`);
  console.log(`👉 주차 관제 서버: http://${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`====================================================`);
});
