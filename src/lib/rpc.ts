/**
 * Minimal JSON-RPC 2.0 WebSocket client.
 * Handles eth_subscribe subscriptions and regular call/response pairs.
 */

type Resolver = { resolve: (v: unknown) => void; reject: (e: Error) => void }

type SubscriptionMsg = {
  method: 'eth_subscription'
  params: { subscription: string; result: unknown }
}

export class RpcClient {
  private ws: WebSocket
  private msgId = 1
  private pending = new Map<number, Resolver>()
  private subscriptions = new Map<string, (data: unknown) => void>()
  private openResolvers: Array<() => void> = []
  public isOpen = false

  public onConnect?: () => void
  public onDisconnect?: () => void
  public onError?: (msg: string) => void

  constructor(url: string) {
    this.ws = new WebSocket(url)
    this.ws.onopen    = this.handleOpen
    this.ws.onclose   = this.handleClose
    this.ws.onerror   = this.handleError
    this.ws.onmessage = this.handleMessage
  }

  private handleOpen = () => {
    this.isOpen = true
    this.openResolvers.forEach((r) => r())
    this.openResolvers = []
    this.onConnect?.()
  }

  private handleClose = () => {
    this.isOpen = false
    const err = new Error('WebSocket closed')
    this.pending.forEach(({ reject }) => reject(err))
    this.pending.clear()
    this.onDisconnect?.()
  }

  private handleError = () => {
    this.onError?.('WebSocket error')
  }

  private handleMessage = (event: MessageEvent) => {
    let msg: { id?: number; result?: unknown; error?: { message: string } } & Partial<SubscriptionMsg>
    try { msg = JSON.parse(event.data as string) } catch { return }

    if (msg.method === 'eth_subscription' && msg.params) {
      this.subscriptions.get(msg.params.subscription)?.(msg.params.result)
      return
    }

    if (msg.id !== undefined) {
      const handler = this.pending.get(msg.id)
      if (handler) {
        this.pending.delete(msg.id)
        if (msg.error) handler.reject(new Error(msg.error.message))
        else handler.resolve(msg.result)
      }
    }
  }

  private waitOpen(): Promise<void> {
    if (this.isOpen) return Promise.resolve()
    const s = this.ws.readyState
    if (s === WebSocket.CLOSED || s === WebSocket.CLOSING) {
      return Promise.reject(new Error('WebSocket is closed'))
    }
    return new Promise((resolve) => this.openResolvers.push(resolve))
  }

  async call<T>(method: string, params: unknown[] = [], timeoutMs = 30_000): Promise<T> {
    await this.waitOpen()
    const id = this.msgId++
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v as T) },
        reject:  (e) => { clearTimeout(t); reject(e) },
      })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  async subscribe<T>(
    type: string,
    filter: unknown,
    handler: (data: T) => void,
  ): Promise<string> {
    const params: unknown[] = filter ? [type, filter] : [type]
    const subId = await this.call<string>('eth_subscribe', params)
    this.subscriptions.set(subId, handler as (d: unknown) => void)
    return subId
  }

  async unsubscribe(subId: string): Promise<void> {
    this.subscriptions.delete(subId)
    try { await this.call('eth_unsubscribe', [subId]) } catch { /* ignore */ }
  }

  close() {
    this.ws.close()
  }
}
