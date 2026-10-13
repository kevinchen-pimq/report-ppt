using System;
using System.Collections;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace BSRemote {
	/// <summary>
	/// Tiny HTTP endpoint on 127.0.0.1:6557. Requests are parsed on the listener thread and run as
	/// coroutines on Unity's main thread (Commands.cs); the listener thread waits for the reply.
	/// Only the PC agent on the same machine talks to it.
	/// </summary>
	public class RemoteController : MonoBehaviour {
		public const int Port = 6557;
		public static RemoteController Instance { get; private set; }

		internal class Reply {
			public int status = 200;
			public string contentType = "application/json";
			public byte[] body = Array.Empty<byte>();

			public static Reply Json(object o, int status = 200) =>
				new Reply { status = status, body = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(o)) };
			public static Reply Error(string message, int status = 400) => Json(new { ok = false, error = message }, status);
		}

		class Job {
			public string method;
			public string path;
			public JObject args;
			public Reply reply;
			public readonly ManualResetEventSlim done = new ManualResetEventSlim(false);
		}

		readonly ConcurrentQueue<Job> jobs = new ConcurrentQueue<Job>();
		HttpListener listener;
		Thread thread;
		volatile bool running;
		Commands commands;

		void Awake() {
			Instance = this;
			commands = new Commands(this);
			try {
				listener = new HttpListener();
				listener.Prefixes.Add($"http://127.0.0.1:{Port}/");
				listener.Start();
				running = true;
				thread = new Thread(Listen) { IsBackground = true, Name = "BSRemote" };
				thread.Start();
				Plugin.Log.Info($"BSRemote listening on 127.0.0.1:{Port}");
			} catch(Exception ex) {
				Plugin.Log.Error($"BSRemote could not listen on port {Port}: {ex}");
			}
		}

		public void Shutdown() {
			running = false;
			try { listener?.Stop(); } catch { }
		}

		void OnDestroy() => Shutdown();

		void Listen() {
			while(running) {
				HttpListenerContext ctx;
				try {
					ctx = listener.GetContext();
				} catch {
					if(!running) return;
					continue;
				}
				ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
			}
		}

		void Handle(HttpListenerContext ctx) {
			Reply reply;
			try {
				var req = ctx.Request;
				var args = new JObject();
				if(req.HasEntityBody) {
					using(var sr = new StreamReader(req.InputStream, Encoding.UTF8)) {
						var text = sr.ReadToEnd();
						if(!string.IsNullOrWhiteSpace(text)) args = JObject.Parse(text);
					}
				}
				foreach(string key in req.QueryString.Keys)
					if(key != null && args[key] == null) args[key] = req.QueryString[key];
				var job = new Job { method = req.HttpMethod, path = req.Url.AbsolutePath.TrimEnd('/'), args = args };
				jobs.Enqueue(job);
				var timeout = (args.Value<double?>("timeout") ?? 120) + 10;
				reply = job.done.Wait(TimeSpan.FromSeconds(timeout)) ? job.reply : Reply.Error("timed out on the game thread", 504);
			} catch(Exception ex) {
				reply = Reply.Error(ex.ToString(), 500);
			}
			try {
				ctx.Response.StatusCode = reply.status;
				ctx.Response.ContentType = reply.contentType;
				ctx.Response.ContentLength64 = reply.body.Length;
				ctx.Response.OutputStream.Write(reply.body, 0, reply.body.Length);
				ctx.Response.OutputStream.Close();
			} catch { }
		}

		void Update() {
			// one job at a time: commands change global game state (scene, time scale, camera)
			if(busy || !jobs.TryDequeue(out var job)) return;
			busy = true;
			StartCoroutine(RunJob(job));
		}

		bool busy;

		IEnumerator RunJob(Job job) {
			var box = new Commands.ReplyBox();
			IEnumerator routine = null;
			try {
				routine = commands.Route(job.method, job.path, job.args, box);
			} catch(Exception ex) {
				box.reply = Reply.Error(ex.ToString(), 500);
			}
			if(routine != null) {
				// run the command's coroutine step by step so exceptions turn into an error reply
				for(;;) {
					object current;
					try {
						if(!routine.MoveNext()) break;
						current = routine.Current;
					} catch(Exception ex) {
						box.reply = Reply.Error(ex.ToString(), 500);
						break;
					}
					yield return current;
				}
			}
			job.reply = box.reply ?? Reply.Json(new { ok = true });
			job.done.Set();
			busy = false;
		}
	}
}
