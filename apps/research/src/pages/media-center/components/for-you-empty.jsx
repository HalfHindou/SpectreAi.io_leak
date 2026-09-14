import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import spectreIcons from '@/icons/spectreIcons'

const ForYouEmpty = () => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  return (
    <div className="mc-empty mc-for-you-empty">
      <span className="mc-empty-icon">{spectreIcons.star}</span>
      <h3 className="mc-empty-title">{t('mediaCenter.forYouEmpty.title')}</h3>
      <p className="mc-empty-desc">{t('mediaCenter.forYouEmpty.desc')}</p>
      <button type="button" className="mc-empty-cta" onClick={() => navigate('/watchlists')}>
        {t('mediaCenter.forYouEmpty.cta')}
      </button>
    </div>
  )
}

export default ForYouEmpty
