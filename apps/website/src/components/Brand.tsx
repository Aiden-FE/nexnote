import { Link } from '../router';

export function Mark({ className = '' }: { className?: string }) {
  return <img className={`mark ${className}`.trim()} src="/brand/mark.svg" alt="" aria-hidden="true" />;
}

export function BrandLink({ href, className = '' }: { href: string; className?: string }) {
  return (
    <Link className={`brand ${className}`.trim()} href={href}>
      <Mark />
      <span className="brand-name">NexNote</span>
    </Link>
  );
}
