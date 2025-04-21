addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

/**
 * 路由分发
 */
async function handleRequest(request) {
  const url = new URL(request.url)
  const { pathname } = url

  // 1. 访问根路径：返回前端 HTML 页面
  if (pathname === '/' && request.method === 'GET') {
    return serveHtmlPage()
  }

  // 2. API：获取所有从未登录的用户
  if (pathname === '/api/listNeverLoggedIn' && request.method === 'GET') {
    return listNeverLoggedInUsers()
  }

  // 3. API：单个删除用户
  if (pathname === '/api/deleteUser' && request.method === 'POST') {
    return deleteSingleUser(request)
  }

  // 其他路径，返回 404
  return new Response('Not Found', { status: 404 })
}

/**
 * 1. 返回一个带进度条的HTML页面
 *    - 前端可点击“获取列表” -> 显示用户
 *    - 前端可点击“逐个删除所有” -> 循环调用后端单个删除API，更新进度条
 */
function serveHtmlPage() {
  const html = `
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <title>批量删除从未登录用户 (带进度)</title>
  <style>
    body {
      font-family: sans-serif;
      margin: 20px;
      background-color: #f7f7f7;
    }
    .btn {
      padding: 8px 16px;
      margin: 0 4px;
      cursor: pointer;
      background: #4CAF50;
      color: #fff;
      border: none;
      border-radius: 4px;
    }
    .btn:hover {
      background: #45A049;
    }
    table {
      border-collapse: collapse;
      margin-top: 16px;
      width: 100%;
      max-width: 600px;
      background: #fff;
    }
    th, td {
      border: 1px solid #ccc;
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background: #f2f2f2;
    }
    .delete-single-btn {
      background-color: #f44336;
    }
    .delete-single-btn:hover {
      background-color: #e53935;
    }
    #progressContainer {
      margin: 16px 0;
      display: none;
    }
    #progressBar {
      width: 100%;
      max-width: 400px;
    }
    #progressText {
      margin-left: 8px;
    }
  </style>
</head>
<body>
  <h1>批量删除从未登录(Hasn't signed in)的用户（带进度）</h1>
  <button class="btn" id="btnList">获取从未登录用户列表</button>
  <!-- 这里采用前端循环删除，后端仅提供单个删除API -->
  <button class="btn" id="btnDeleteAll">逐个删除所有(前端带进度)</button>

  <!-- 进度条容器 -->
  <div id="progressContainer">
    <progress id="progressBar" value="0" max="100"></progress>
    <span id="progressText"></span>
  </div>

  <table id="userTable" style="display: none;">
    <thead>
      <tr>
        <th>邮箱 (primaryEmail)</th>
        <th>最后登录时间 (lastLoginTime)</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>

  <script>
    const btnList = document.getElementById('btnList')
    const btnDeleteAll = document.getElementById('btnDeleteAll')
    const userTable = document.getElementById('userTable')
    const tbody = userTable.querySelector('tbody')

    // 进度条相关
    const progressContainer = document.getElementById('progressContainer')
    const progressBar = document.getElementById('progressBar')
    const progressText = document.getElementById('progressText')

    // 缓存“从未登录”的用户列表
    let neverLoggedInUsers = []

    // 1. 获取从未登录用户列表
    btnList.addEventListener('click', async () => {
      try {
        // 清空现有表格
        tbody.innerHTML = ''
        userTable.style.display = 'none'
        neverLoggedInUsers = []

        const res = await fetch('/api/listNeverLoggedIn')
        if (!res.ok) {
          const err = await res.text()
          alert('获取列表失败: ' + err)
          return
        }
        const data = await res.json()
        if (data.length === 0) {
          alert('没有“从未登录”的用户')
          return
        }

        neverLoggedInUsers = data

        // 生成表格
        data.forEach(user => {
          const tr = document.createElement('tr')
          tr.innerHTML = \`
            <td>\${user.primaryEmail}</td>
            <td>\${user.lastLoginTime || 'Never'}</td>
            <td>
              <button class="btn delete-single-btn" data-email="\${user.primaryEmail}">
                删除
              </button>
            </td>
          \`
          tbody.appendChild(tr)
        })

        userTable.style.display = 'table'

        // 给每行的“删除”按钮绑定事件 - 单个删除
        document.querySelectorAll('.delete-single-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            const email = e.target.getAttribute('data-email')
            if (!confirm(\`确认删除用户 \${email} 吗？\`)) return

            try {
              const delOK = await deleteSingleUser(email)
              if (delOK) {
                alert(\`已删除用户: \${email}\`)
                // 从表格中移除
                e.target.closest('tr').remove()
                // 从 neverLoggedInUsers 数组中移除该用户
                neverLoggedInUsers = neverLoggedInUsers.filter(u => u.primaryEmail !== email)
              } else {
                alert('删除失败')
              }
            } catch (err) {
              alert('删除出错: ' + err.message)
            }
          })
        })
      } catch (err) {
        alert('请求出错: ' + err.message)
      }
    })

    // 2. 逐个删除所有从未登录用户（前端循环 + 进度条）
    btnDeleteAll.addEventListener('click', async () => {
      if (neverLoggedInUsers.length === 0) {
        alert('请先点击“获取列表”，或列表为空，无可删除用户')
        return
      }

      if (!confirm(\`是否确认删除所有“从未登录”用户？共 \${neverLoggedInUsers.length} 个。此操作不可逆！\`)) {
        return
      }

      // 显示进度容器并初始化
      progressContainer.style.display = 'block'
      progressBar.value = 0
      progressBar.max = neverLoggedInUsers.length
      progressText.textContent = \`0 / \${neverLoggedInUsers.length}\`

      let successCount = 0
      let failCount = 0

      // 逐个执行删除
      for (let i = 0; i < neverLoggedInUsers.length; i++) {
        const user = neverLoggedInUsers[i]
        const email = user.primaryEmail

        try {
          const delOK = await deleteSingleUser(email)
          if (delOK) {
            successCount++
            // 从DOM表格中移除对应行
            const row = tbody.querySelector(\`button[data-email="\${email}"]\`)?.closest('tr')
            row && row.remove()
          } else {
            failCount++
          }
        } catch (err) {
          failCount++
          console.error(err)
        }

        // 更新进度
        progressBar.value = i + 1
        progressText.textContent = \`\${i + 1} / \${neverLoggedInUsers.length}\`
      }

      // 删除完毕
      neverLoggedInUsers = []
      alert(\`删除完成！成功: \${successCount} 个, 失败: \${failCount} 个\`)

      // 可选择隐藏进度条
      // progressContainer.style.display = 'none'
    })

    /**
     * 封装单个删除请求
     * @param {string} email
     * @returns {Promise<boolean>} 是否删除成功
     */
    async function deleteSingleUser(email) {
      const res = await fetch('/api/deleteUser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      return res.ok
    }
  </script>
</body>
</html>
`
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=UTF-8' },
  })
}

/**
 * 2. API: 列出所有从未登录(Hasn't signed in)的用户
 */
async function listNeverLoggedInUsers() {
  try {
    const accessToken = await getAccessToken()
    const allUsers = await listAllUsers(accessToken)

    // 筛选：从未登录 -> lastLoginTime 通常是 undefined 或 '1970-01-01T00:00:00.000Z'
    const neverLoggedInUsers = allUsers.filter(u => {
      return !u.lastLoginTime || u.lastLoginTime === '1970-01-01T00:00:00.000Z'
    })

    return new Response(JSON.stringify(neverLoggedInUsers), {
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    })
  } catch (err) {
    return new Response(`获取从未登录用户列表失败: ${err.message}`, { status: 500 })
  }
}

/**
 * 3. API: 单个删除用户
 * @param {Request} request
 */
async function deleteSingleUser(request) {
  try {
    const { email } = await request.json()
    if (!email) {
      return new Response('缺少 email 参数', { status: 400 })
    }

    const accessToken = await getAccessToken()
    const url = 'https://admin.googleapis.com/admin/directory/v1/users/' + encodeURIComponent(email)
    const resp = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + accessToken },
    })

    if (resp.ok) {
      return new Response('删除成功')
    } else {
      const errText = await resp.text()
      return new Response(`删除失败: ${errText}`, { status: 500 })
    }
  } catch (err) {
    return new Response(`删除用户出错: ${err.message}`, { status: 500 })
  }
}

/**
 * 工具函数：分页获取所有用户
 */
async function listAllUsers(accessToken) {
  let pageToken = null
  const users = []

  do {
    const url = new URL('https://admin.googleapis.com/admin/directory/v1/users')
    // 'my_customer' 表示列出整个组织下的用户
    url.searchParams.set('customer', 'my_customer')
    // 一次最多 500 个，如果用户量很多，需要不断翻页
    url.searchParams.set('maxResults', '500')

    if (pageToken) {
      url.searchParams.set('pageToken', pageToken)
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: 'Bearer ' + accessToken },
    })
    if (!response.ok) {
      const errText = await response.text()
      throw new Error('获取用户列表失败: ' + errText)
    }

    const data = await response.json()
    if (data.users) {
      users.push(...data.users)
    }
    pageToken = data.nextPageToken
  } while (pageToken)

  return users
}

/**
 * 工具函数：获取 Access Token
 * 通过 OAuth 2.0 Refresh Token 换取
 */
async function getAccessToken() {
  const tokenEndpoint = 'https://oauth2.googleapis.com/token'
  const params = new URLSearchParams()
  params.append('client_id', GOOGLE_CLIENT_ID)
  params.append('client_secret', GOOGLE_CLIENT_SECRET)
  params.append('refresh_token', GOOGLE_REFRESH_TOKEN)
  params.append('grant_type', 'refresh_token')

  const tokenResp = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })

  if (!tokenResp.ok) {
    const errText = await tokenResp.text()
    throw new Error('获取AccessToken失败: ' + errText)
  }

  const tokenData = await tokenResp.json()
  return tokenData.access_token
}

/**  
 * 敏感信息在此示例中直接写死  
 * 建议在生产环境使用 Workers Secrets 或环境变量管理  
 * 
 * const GOOGLE_CLIENT_ID = 'your-client-id.apps.googleusercontent.com' 
 * const GOOGLE_CLIENT_SECRET = 'your-client-secret' 
 * const GOOGLE_REFRESH_TOKEN = 'your-refresh-token' 
 */
