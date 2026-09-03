"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Clapperboard, Compass, Gift, Heart, MessageCircle, Play, Radio, Send, Users, WalletCards } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { SocialLinks } from "@/components/ui/SocialLinks";
import VantaLogo from "@/components/ui/VantaLogo";

const nav = [{ href: "#discover", label: "Discover" }, { href: "#reels", label: "Reels" }, { href: "/live", label: "Live" }, { href: "#creators", label: "Creators" }];

function Brand() { return <span className="vanta-brand"><VantaLogo size={25} /><span>VANTA</span></span>; }

function ProductStage() {
  return <div className="product-stage" aria-label="Preview of the VANTA social experience">
    <div className="product-window">
      <header><Brand /><small>FOR YOU</small><span className="avatar">AR</span></header>
      <div className="product-layout">
        <nav>{[Compass, Clapperboard, Radio, MessageCircle].map((Icon, i) => <span className={i === 0 ? "active" : ""} key={i}><Icon size={16} /></span>)}</nav>
        <article>
          <div className="stories">{["AR", "KM", "SO", "JL"].map((x, i) => <span className={i === 0 ? "active" : ""} key={x}>{x}</span>)}</div>
          <div className="product-post">
            <div className="author"><span>AR</span><p><b>Ari Rhodes</b><small>@arirhodes · now</small></p></div>
  <div className="product-media"><span>NEW WORK / LONDON</span></div>
            <div className="post-copy"><p>An honest look at the process behind the frame.</p><div><span><Heart size={14} /> Like</span><span><MessageCircle size={14} /> Comment</span><span><Send size={14} /> Share</span></div></div>
          </div>
        </article>
      </div>
    </div>
    <div className="mode-strip"><span className="active"><Compass size={14} /> Discover</span><span><Clapperboard size={14} /> Reels</span><span><Radio size={14} /> Live</span><span><MessageCircle size={14} /> Chat</span></div>
  </div>;
}

function ReelsVisual() { return <div className="reels-visual"><div className="reel-primary"><div className="reel-top"><span>REELS</span><Clapperboard size={18} /></div><button aria-label="Play reel"><Play size={20} fill="currentColor" /></button><div className="reel-caption"><b>@arirhodes</b><p>Process, perspective, and the final frame.</p></div></div></div>; }
function ValueVisual() { return <div className="value-console"><header><span>CREATOR VALUE</span><WalletCards size={18} /></header><div className="value-main"><small>VANTA BALANCE</small><b>Everything you earn.<br />Clearly accounted for.</b></div><div className="value-actions"><span><Gift size={17} /><b>Gifts</b><small>From your community</small></span><span><WalletCards size={17} /><b>Earnings</b><small>Creator activity</small></span></div><footer><span>Transactions</span><span>Withdraw</span><ArrowUpRight size={15} /></footer></div>; }

export default function LandingExperience() {
  const { user, isLoading } = useAuth(); const router = useRouter(); const [scrolled, setScrolled] = useState(false);
  useEffect(() => { const fn = () => setScrolled(scrollY > 10); addEventListener("scroll", fn, { passive: true }); return () => removeEventListener("scroll", fn); }, []);
  useEffect(() => { if (!isLoading && user) router.replace("/reels"); }, [isLoading, user, router]);
  return <main className="landing-page">
    <header className={`landing-header ${scrolled ? "scrolled" : ""}`}><div className="landing-nav"><Link href="/" aria-label="VANTA home"><Brand /></Link><nav className="landing-links">{nav.map(x => x.href[0] === "#" ? <a href={x.href} key={x.label}>{x.label}</a> : <Link href={x.href} key={x.label}>{x.label}</Link>)}<Link href="/login">Log in</Link><Link className="gold-button small" href="/register">Create account</Link></nav></div></header>
    <section className="landing-hero"><div className="hero-copy"><p className="eyebrow"><i /> THE SOCIAL PLATFORM FOR CREATORS</p><h1><span>VANTA</span>Create.<br />Connect. <em>Live.</em></h1><p className="hero-description">Publish what matters. Find original voices. Build real communities. Turn your audience into lasting value.</p><div className="hero-actions"><Link className="gold-button" href="/register">Create your account <ArrowRight size={16} /></Link><Link className="secondary-button" href="/discover">Explore VANTA <ArrowUpRight size={15} /></Link></div><div className="capabilities"><span>POSTS</span><span>REELS</span><span>LIVE</span><span>CHAT</span><span>CREATOR VALUE</span></div></div><ProductStage /></section>
    <div className="ecosystem-strip"><span>ONE IDENTITY</span><i /><span>EVERY FORMAT</span><i /><span>ONE COMMUNITY</span><i /><span>YOUR VALUE</span></div>
    <section className="landing-intro" id="discover"><div><p className="eyebrow"><i /> ONE CONNECTED ECOSYSTEM</p><h2>Everything social.<br /><em>Built around people.</em></h2></div><p>Move from discovery to conversation, from a post to a live room, and from audience support to creator earnings without rebuilding your world on another platform.</p></section>
    <section className="feature-section" id="reels"><ReelsVisual /><div className="feature-copy"><span>01 / CREATE</span><Clapperboard /><h2>Every way you create.<br />One place to be known.</h2><p>Share posts, publish reels, and go live with the same identity and the same community around your work.</p><div className="text-links"><Link href="/home">Posts <ArrowUpRight /></Link><Link href="/reels">Reels <ArrowUpRight /></Link><Link href="/live">Live <ArrowUpRight /></Link></div></div></section>
    <section className="feature-section connection"><div className="feature-copy"><span>02 / CONNECT</span><Users /><h2>Discovery that leads<br />somewhere meaningful.</h2><p>Find creators and communities, then move naturally into chats, groups, channels, and real-time rooms.</p><Link className="inline-link" href="/discover">Start discovering <ArrowUpRight /></Link></div><div className="connection-visual"><header><span>YOUR CIRCLES</span><b>Conversations with momentum.</b></header>{[["DF","Design Futures","Channel · Active now"],["FC","Film Collective","Group · New conversation"],["NS","Night Studio","Live room · Open"]].map(x => <div className="circle-row" key={x[0]}><i>{x[0]}</i><b>{x[1]}<small>{x[2]}</small></b><ArrowUpRight /></div>)}<footer><MessageCircle /> PUBLIC MOMENTS <i /> PRIVATE CONNECTION</footer></div></section>
    <section className="feature-section creator" id="creators"><ValueVisual /><div className="feature-copy"><span className="gold">03 / CREATOR ECONOMY</span><Gift /><h2>Attention is more than a number.</h2><p>Receive gifts, understand creator earnings, manage your VANTA balance, and keep a clear view of every transaction.</p><Link className="inline-link gold" href="/creator">Explore Creator Studio <ArrowUpRight /></Link></div></section>
    <section className="final-cta"><p className="eyebrow"><i /> YOUR WORLD STARTS HERE</p><h2>Make something.<br />Find your people.<br /><em>Go live.</em></h2><div><Link className="gold-button" href="/register">Join VANTA <ArrowRight /></Link><Link href="/login">Already a member? Log in</Link></div></section>
    <footer className="landing-footer"><div><section><Brand /><p>Create. Connect. Live.</p><SocialLinks className="landing-socials" iconSize="lg" /></section><nav><Link href="/discover">Discover</Link><Link href="/reels">Reels</Link><Link href="/live">Live</Link><Link href="/creator">Creators</Link><Link href="/contact">Contact</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></div><small>© {new Date().getFullYear()} VANTA <span>A social and creator platform.</span></small></footer>
  </main>;
}